const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connectTestDatabase } = require('../scripts/test-postgres.cjs');
const { createPrismaRuntime } = require('../dist/db/prisma');
const { createPostgresIngredientService } = require('../dist/services/ingredient.postgres.service');
const { createApp } = require('../dist/app');

test('PostgreSQL Ingredient HTTP API with real Prisma, concurrency and isolated cleanup', {
    skip: !process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not configured' : false, timeout: 60000,
}, async t => {
    // Do not load dotenv, use DATABASE_URL, or connect until the dedicated guard passes.
    const guard = await connectTestDatabase(process.env.TEST_DATABASE_URL);
    await guard.end();
    const environment = { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL };
    const runtime = createPrismaRuntime(environment);
    const prefix = `PG_ING_${randomUUID().replaceAll('-', '').toUpperCase()}`;
    const codes = ['A', 'B', 'C', 'RACE', 'CONFLICT'].map(suffix => `${prefix}_${suffix}`);
    const beforeEnv = { NODE_ENV: process.env.NODE_ENV, CATALOG_INGREDIENT_STORE: process.env.CATALOG_INGREDIENT_STORE };
    let io, connected = false;
    let first;
    try {
        await runtime.connect(); connected = true;
        assert.equal(await runtime.ready(), true);
        process.env.NODE_ENV = 'test'; process.env.CATALOG_INGREDIENT_STORE = 'postgres';
        const app = createApp(() => runtime.ready(), { postgresIngredients: createPostgresIngredientService(runtime.client) });
        io = app.io;
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}`;
        const request = async (path = '', method = 'GET', body) => {
            const res = await fetch(base + '/api/ingredients' + path, { method,
                ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
            return { status: res.status, body: await res.json() };
        };
        const data = code => ({ code, name: ' Same name ', category: ` ${prefix} `, unit: 'g', costPrice: '99999999999999.1234', minStock: '0.000001' });
        await t.test('HTTP creation persists UUIDs, exact decimals, normalization and defaults', async () => {
            for (const code of codes.slice(0, 3)) {
                const result = await request('', 'POST', data(` ${code.toLowerCase()} `));
                assert.equal(result.status, 201);
                const record = result.body.data; first ??= record;
                assert.match(record._id, /^[a-f\d-]{36}$/); assert.equal(record.code, code);
                assert.equal(record.name, 'Same name'); assert.equal(record.category, prefix);
                assert.equal(record.costPrice, '99999999999999.1234'); assert.equal(record.minStock, '0.000001');
                assert.equal(record.__v, undefined); assert.equal(record.id, undefined); assert.equal(record.isActive, true);
                const stored = await runtime.client.ingredient.findUnique({ where: { id: record._id } });
                assert.equal(stored.costPrice.toFixed(4), record.costPrice);
            }
            const defaults = await request('', 'POST', { code: codes[4], name: 'Default', category: prefix, unit: 'ml', costPrice: 0.5 });
            assert.equal(defaults.status, 201); assert.equal(defaults.body.data.minStock, '0'); assert.equal(defaults.body.data.costPrice, '0.5');
        });
        assert.ok(first, 'Creation must pass before dependent checks');
        await t.test('invalid input is rejected before database mutation and missing UUIDs return 404', async () => {
            const before = await runtime.client.ingredient.count({ where: { category: prefix } });
            for (const change of [{ costPrice: '1.00001' }, { minStock: '0.0000001' }, { costPrice: '100000000000000' },
                { costPrice: 99999999999999.12 }, { costPrice: 'NaN' }, { code: 'A'.repeat(65) }, { name: '\0' }, { _id: randomUUID() }, { unit: 'kg' }]) {
                assert.deepEqual(await request('', 'POST', { ...data(codes[0]), ...change }), { status: 400, body: { error: 'Invalid request' } });
            }
            assert.equal(await runtime.client.ingredient.count({ where: { category: prefix } }), before);
            for (const method of ['GET', 'PATCH', 'DELETE']) {
                assert.equal((await request('/0123456789abcdef01234567', method, method === 'PATCH' ? { name: 'X' } : undefined)).status, 400);
                assert.deepEqual(await request('/' + randomUUID(), method, method === 'PATCH' ? { name: 'X' } : undefined), { status: 404, body: { error: 'Ingredient not found' } });
            }
        });
        await t.test('database uniqueness maps POST/PATCH to 409 and reserves normalized codes', async () => {
            assert.deepEqual(await request('', 'POST', data(codes[0].toLowerCase())), { status: 409, body: { error: 'Ingredient code already exists' } });
            assert.deepEqual(await request('/' + first._id, 'PATCH', { code: codes[1] }), { status: 409, body: { error: 'Ingredient code already exists' } });
            assert.equal((await request('/' + first._id)).body.data.code, codes[0]);
        });
        await t.test('literal search, default active filter, exact filters, numeric sorting and tied pagination', async () => {
            const filter = `?category=${prefix}&unit=g&sortBy=name&limit=2`;
            const a = await request(filter + '&page=1'); const b = await request(filter + '&page=2');
            assert.equal(a.body.pagination.total, 3);
            const ids = [...a.body.data, ...b.body.data].map(r => r._id);
            assert.equal(new Set(ids).size, 3); assert.deepEqual(ids, [...ids].sort());
            assert.deepEqual((await request(filter + '&page=1')).body, a.body);
            assert.equal((await request(`?category=${prefix.toLowerCase()}`)).body.pagination.total, 0);
            const marker = '%_\\.*';
            await request('/' + first._id, 'PATCH', { name: 'Literal ' + marker, costPrice: '2' });
            const searched = await request(`?category=${prefix}&search=${encodeURIComponent(marker)}`);
            assert.deepEqual(searched.body.data.map(r => r._id), [first._id]);
            assert.deepEqual((await request(`?category=${prefix}&search=${codes[1].toLowerCase()}`)).body.data.map(r => r.code), [codes[1]]);
            assert.equal((await request(`?category=${prefix}&unit=g&sortBy=costPrice&sortOrder=asc`)).body.data[0]._id, first._id);
        });
        await t.test('concurrent duplicate POST and PATCH produce exactly one success', async () => {
            const created = await Promise.all([request('', 'POST', data(codes[3])), request('', 'POST', data(codes[3]))]);
            assert.deepEqual(created.map(r => r.status).sort(), [201, 409]);
            assert.equal(await runtime.client.ingredient.count({ where: { code: codes[3] } }), 1);
            const other = await runtime.client.ingredient.findUnique({ where: { code: codes[1] } });
            // Both requests compete for a fresh code owned by this fixture.
            codes.push(codes[0] + '_NEW');
            const changed = await Promise.all([request('/' + first._id, 'PATCH', { code: codes[0] + '_NEW' }), request('/' + other.id, 'PATCH', { code: codes[0] + '_NEW' })]);
            assert.deepEqual(changed.map(r => r.status).sort(), [200, 409]);
        });
        await t.test('independent concurrent PATCH operations preserve both changes and omitted fields', async () => {
            const results = await Promise.all([request('/' + first._id, 'PATCH', { name: ' Concurrent ' }), request('/' + first._id, 'PATCH', { minStock: '0.500000' })]);
            assert.ok(results.every(r => r.status === 200));
            const stored = (await request('/' + first._id)).body.data;
            assert.equal(stored.name, 'Concurrent'); assert.equal(stored.minStock, '0.5'); assert.equal(stored.category, prefix);
            assert.equal(stored.costPrice, '2');
        });
        await t.test('soft DELETE is idempotent under concurrency, preserves timestamps and reserves code', async () => {
            const results = await Promise.all([request('/' + first._id, 'DELETE'), request('/' + first._id, 'DELETE')]);
            assert.ok(results.every(r => r.status === 200)); assert.deepEqual(results[0], results[1]);
            const deleted = results[0]; assert.equal(deleted.body.data.isActive, false);
            assert.deepEqual(await request('/' + first._id, 'DELETE'), deleted);
            assert.deepEqual(await request('/' + first._id), deleted);
            const raw = await runtime.client.$queryRaw`SELECT updated_at::text AS stamp FROM ingredients WHERE id=${first._id}::uuid`;
            await request('/' + first._id, 'DELETE');
            assert.deepEqual(await runtime.client.$queryRaw`SELECT updated_at::text AS stamp FROM ingredients WHERE id=${first._id}::uuid`, raw);
            assert.equal((await request(`?category=${prefix}&isActive=false`)).body.data[0]._id, first._id);
            assert.ok(!(await request(`?category=${prefix}`)).body.data.some(r => r._id === first._id));
            assert.equal((await request('', 'POST', data(deleted.body.data.code))).status, 409);
            const reactivated = await request('/' + first._id, 'PATCH', { isActive: true });
            assert.equal(reactivated.status, 200); assert.equal(reactivated.body.data.isActive, true);
        });
        await t.test('health and mode-specific OpenAPI report the actual PostgreSQL contract', async () => {
            assert.equal((await fetch(base + '/health')).status, 200);
            const docs = await (await fetch(base + '/api-docs.json')).json();
            assert.equal(docs.components.schemas.Ingredient.properties._id.format, 'uuid');
            assert.equal(docs.components.schemas.Ingredient.properties.costPrice.type, 'string');
            assert.equal(docs.components.schemas.Ingredient.properties.__v, undefined);
            assert.ok(docs.paths['/api/products']); assert.ok(docs.paths['/api/recipes']);
        });
    } finally {
        try { if (io) await new Promise(resolve => io.close(resolve)); }
        finally {
            try {
                if (connected) {
                    const cleanupGuard = await connectTestDatabase(process.env.TEST_DATABASE_URL);
                    await cleanupGuard.end();
                    // Only this test's exact random codes AND category can be removed.
                    await runtime.client.ingredient.deleteMany({ where: { category: prefix, code: { in: codes } } });
                    assert.equal(await runtime.client.ingredient.count({ where: { category: prefix } }), 0);
                }
            } finally {
                await runtime.close();
                for (const [key, value] of Object.entries(beforeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
            }
        }
    }
});
