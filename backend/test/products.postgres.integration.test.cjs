const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connectTestDatabase } = require('../scripts/test-postgres.cjs');
const { createPrismaRuntime } = require('../dist/db/prisma');
const { createPostgresProductService } = require('../dist/services/product.postgres.service');
const { createPostgresIngredientService } = require('../dist/services/ingredient.postgres.service');
const { createApp } = require('../dist/app');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function atGate(gate) {
    let timer;
    try {
        return await Promise.race([gate.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Transaction scheduling gate was not reached')), 2500);
        })]);
    } finally { clearTimeout(timer); }
}

// Test-only transaction interception. The real SQL still executes on the same
// transaction/connection; failure and scheduling hooks are never production options.
function interceptedClient(db, hook) {
    return new Proxy(db, { get(target, key) {
        if (key !== '$transaction') return target[key];
        return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, { get(connection, model) {
            if (!['product', 'productVariant'].includes(model)) return connection[model];
            return new Proxy(connection[model], { get(delegate, method) {
                if (typeof delegate[method] !== 'function') return delegate[method];
                return (...args) => hook({ tx, model, method, args, run: () => delegate[method](...args) });
            } });
        } })), options);
    } });
}

test('PostgreSQL Product HTTP API: real transactions, identities, reference races and cleanup', {
    skip: !process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not configured' : false, timeout: 120000,
}, async t => {
    // No dotenv, development fallback, schema synchronization, or MongoDB writes.
    const observer = await connectTestDatabase(process.env.TEST_DATABASE_URL);
    const runtime = createPrismaRuntime({ NODE_ENV: 'test', CATALOG_PRODUCT_STORE: 'postgres', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
    const db = runtime.client;
    const prefix = 'PG_PROD_' + randomUUID().replaceAll('-', '').toUpperCase();
    const ownedCodes = new Set(), ownedRecipes = new Set();
    const ingredientId = randomUUID(); let connected = false, sequence = 0;
    const beforeEnv = { NODE_ENV: process.env.NODE_ENV, CATALOG_INGREDIENT_STORE: process.env.CATALOG_INGREDIENT_STORE, CATALOG_PRODUCT_STORE: process.env.CATALOG_PRODUCT_STORE };
    const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
    const nextCode = () => { const code = `${prefix}_${++sequence}`; ownedCodes.add(code); return code; };
    const requestFor = base => async (path = '', method = 'GET', body) => {
        const res = await fetch(base + '/api/products' + path, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
        return { status: res.status, body: await res.json() };
    };
    async function withApi(service, callback) {
        const app = createApp(() => runtime.ready(), { postgresProducts: service });
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}`;
        try { return await callback(requestFor(base), base); }
        finally { await new Promise(resolve => app.io.close(resolve)); }
    }
    async function snapshot(id) {
        const rows = await db.$queryRaw`
            SELECT jsonb_build_object('product',to_jsonb(p),
                'variants',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM product_variants v WHERE v.product_id=p.id),'[]'::jsonb),
                'recipes',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM recipes r JOIN product_variants v ON v.id=r.product_variant_id WHERE v.product_id=p.id),'[]'::jsonb),
                'memberships',COALESCE((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id) FROM recipe_ingredients ri JOIN recipes r ON r.id=ri.recipe_id JOIN product_variants v ON v.id=r.product_variant_id WHERE v.product_id=p.id),'[]'::jsonb)) AS snapshot
            FROM products p WHERE p.id=${id}::uuid`;
        return rows[0]?.snapshot;
    }
    async function waitForBlocked(pid) {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
            const { rows: [row] } = await observer.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                AND usename=current_user AND $1=ANY(pg_blocking_pids(pid))) blocked`, [pid]);
            if (row.blocked) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail('Expected real PostgreSQL lock contention was not observed');
    }
    async function recipe(variantId, version = 1, membership = false) {
        const id = randomUUID(); ownedRecipes.add(id);
        await db.recipe.create({ data: { id, productVariantId: variantId, version,
            ...(membership ? { ingredients: { create: { ingredientId, quantity: '0.1' } } } : {}) } });
        return id;
    }
    try {
        await runtime.connect(); connected = true;
        Object.assign(process.env, { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'mongodb', CATALOG_PRODUCT_STORE: 'postgres' });
        await db.ingredient.create({ data: { id: ingredientId, code: prefix + '_ING', name: 'Recipe fixture', category: prefix, unit: 'g', costPrice: '0' } });
        const service = createPostgresProductService(db);
        await withApi(service, async (request, base) => {
            const make = async (fields = {}) => {
                const response = await request('', 'POST', { code: nextCode(), name: ' Same name ', category: prefix,
                    prices: [{ size: 'S', price: '1' }, { size: 'M', price: '2' }], ...fields });
                assert.equal(response.status, 201); return response.body.data;
            };
            let first;
            await t.test('creation, UUIDs, canonical prices, optional fields and S/M/L ordering', async () => {
                const code = nextCode();
                const result = await request('', 'POST', { code: ` ${code.toLowerCase()} `, name: ' Latte ', category: ` ${prefix} `,
                    prices: [{ size: 'L', price: '99999999999999.1234' }, { size: 'S', price: 0.5 }, { size: 'M', price: '000.1000' }] });
                assert.equal(result.status, 201); first = result.body.data;
                assert.equal(first.code, code); assert.equal(first.name, 'Latte'); assert.equal(first.category, prefix); assert.equal(first.isAvailable, true);
                assert.match(first._id, /^[a-f\d-]{36}$/); assert.equal(first.__v, undefined); assert.equal(first.id, undefined);
                assert.equal(Object.hasOwn(first, 'description'), false); assert.equal(Object.hasOwn(first, 'imageUrl'), false);
                assert.deepEqual(first.prices, [{ size: 'S', price: '0.5' }, { size: 'M', price: '0.1' }, { size: 'L', price: '99999999999999.1234' }]);
                assert.ok(first.prices.every(item => Object.keys(item).sort().join() === 'price,size'));
                const optional = await make({ description: ' Fresh ', imageUrl: ' ', isAvailable: false });
                assert.equal(optional.description, 'Fresh'); assert.equal(optional.imageUrl, ''); assert.equal(optional.isAvailable, false);
            });
            assert.ok(first, 'Creation must succeed before dependent checks');
            await t.test('invalid values cause 400 before mutation; missing UUIDs return 404', async () => {
                const before = await snapshot(first._id);
                for (const body of [{ prices: [] }, { prices: [{ size: 'M', price: '1.00001' }] }, { prices: [{ size: 'M', price: '100000000000000' }] },
                    { prices: [{ size: 'M', price: 99999999999999.12 }] }, { prices: [{ size: 'M', price: 1 }, { size: 'M', price: 2 }] },
                    { prices: [{ size: 'M', price: '1', id: randomUUID() }] }, { description: null }, { imageUrl: null }, { name: '\0' }, { code: 'X'.repeat(65) }, { __v: 1 }]) {
                    assert.deepEqual(await request('/' + first._id, 'PATCH', body), { status: 400, body: { error: 'Invalid request' } });
                }
                assert.deepEqual(await snapshot(first._id), before);
                for (const method of ['GET', 'PATCH', 'DELETE']) {
                    assert.equal((await request('/0123456789abcdef01234567', method, method === 'PATCH' ? { name: 'X' } : undefined)).status, 400);
                    assert.deepEqual(await request('/' + randomUUID(), method, method === 'PATCH' ? { name: 'X' } : undefined), { status: 404, body: { error: 'Product not found' } });
                }
            });
            await t.test('optional omission/clearing, exact filters, literal searches and pagination', async () => {
                await request('/' + first._id, 'PATCH', { description: ' Fresh ', imageUrl: ' image ' });
                await request('/' + first._id, 'PATCH', { name: 'Literal %_\\.*' });
                const kept = (await request('/' + first._id)).body.data;
                assert.equal(kept.description, 'Fresh'); assert.equal(kept.imageUrl, 'image');
                const cleared = await request('/' + first._id, 'PATCH', { description: ' ', imageUrl: '' });
                assert.equal(cleared.body.data.description, ''); assert.equal(cleared.body.data.imageUrl, '');
                const searched = await request(`?category=${prefix}&search=${encodeURIComponent('%_\\.*')}`);
                assert.deepEqual(searched.body.data.map(p => p._id), [first._id]);
                assert.deepEqual((await request(`?category=${prefix}&search=${first.code.toLowerCase()}`)).body.data.map(p => p._id), [first._id]);
                assert.equal((await request(`?category=${prefix.toLowerCase()}`)).body.pagination.total, 0);
                const all = await request(`?category=${prefix}`);
                assert.equal(all.body.pagination.total, 2);
                assert.equal((await request(`?category=${prefix}&isAvailable=true`)).body.pagination.total, 1);
                assert.equal((await request(`?category=${prefix}&isAvailable=false`)).body.pagination.total, 1);
                const pages = await Promise.all([request(`?category=${prefix}&limit=1&page=1`), request(`?category=${prefix}&limit=1&page=2`)]);
                assert.deepEqual(pages.flatMap(p => p.body.data.map(p => p.code)), [...ownedCodes].sort());
            });
            await t.test('retained variant identity, creation timestamps, prices-only timestamp and reintroduction', async () => {
                const p = await make(); const before = await snapshot(p._id);
                const changed = await request('/' + p._id, 'PATCH', { prices: [{ size: 'M', price: '3' }, { size: 'S', price: '4' }, { size: 'L', price: '5' }] });
                assert.equal(changed.status, 200);
                const after = await snapshot(p._id);
                for (const variant of before.variants) {
                    const retained = after.variants.find(v => v.size === variant.size);
                    assert.equal(retained.id, variant.id); assert.equal(retained.created_at, variant.created_at);
                }
                assert.notEqual(after.product.updated_at, before.product.updated_at);
                const sId = after.variants.find(v => v.size === 'S').id;
                assert.equal((await request('/' + p._id, 'PATCH', { prices: [{ size: 'M', price: '3' }] })).status, 200);
                assert.equal((await request('/' + p._id, 'PATCH', { prices: [{ size: 'S', price: '4' }, { size: 'M', price: '3' }] })).status, 200);
                assert.notEqual((await snapshot(p._id)).variants.find(v => v.size === 'S').id, sId);
            });
            await t.test('draft, inactive historical and active Recipe references reject removal without any changes', async () => {
                for (const state of ['draft', 'inactive', 'active']) {
                    const p = await make(); const variant = (await snapshot(p._id)).variants.find(v => v.size === 'M');
                    const recipeId = await recipe(variant.id, 1, state !== 'draft');
                    if (state === 'active') await db.productVariant.update({ where: { id: variant.id }, data: { activeRecipeId: recipeId } });
                    if (state === 'inactive') {
                        const current = await recipe(variant.id, 2, true);
                        await db.productVariant.update({ where: { id: variant.id }, data: { activeRecipeId: current } });
                    }
                    const before = await snapshot(p._id);
                    const rejected = await request('/' + p._id, 'PATCH', { name: 'Must roll back', description: 'No write', prices: [{ size: 'S', price: '7' }, { size: 'L', price: '8' }] });
                    assert.deepEqual(rejected, { status: 409, body: { error: 'Cannot remove a size referenced by recipes' } });
                    assert.deepEqual(await snapshot(p._id), before);
                    // Updating the referenced size's price is allowed without changing identity/history/pointer.
                    assert.equal((await request('/' + p._id, 'PATCH', { prices: [{ size: 'M', price: '9' }, { size: 'S', price: '1' }] })).status, 200);
                    const after = await snapshot(p._id); const retained = after.variants.find(v => v.size === 'M');
                    assert.equal(retained.id, variant.id); assert.equal(retained.created_at, variant.created_at);
                    assert.equal(retained.active_recipe_id, before.variants.find(v => v.id === variant.id).active_recipe_id);
                    assert.deepEqual(after.recipes, before.recipes); assert.deepEqual(after.memberships, before.memberships);
                }
            });
            await t.test('forced failures after real partial create/update writes roll back the complete aggregate', async () => {
                const p = await make(); const before = await snapshot(p._id);
                const failedCode = nextCode();
                const broken = interceptedClient(db, async context => {
                    if (context.model === 'product' && context.method === 'create') { await context.run(); throw new Error('private-password create failure'); }
                    if (context.model === 'product' && context.method === 'update') throw new Error('private-password after variant mutation');
                    return context.run();
                });
                await withApi(createPostgresProductService(broken), async failing => {
                    assert.deepEqual(await failing('', 'POST', { code: failedCode, name: 'Broken', category: prefix, prices: [{ size: 'S', price: '1' }] }), { status: 500, body: { error: 'Internal server error' } });
                    assert.equal(await db.product.count({ where: { code: failedCode } }), 0);
                    assert.deepEqual(await failing('/' + p._id, 'PATCH', { name: 'Broken', prices: [{ size: 'M', price: '9' }, { size: 'L', price: '8' }] }), { status: 500, body: { error: 'Internal server error' } });
                });
                assert.deepEqual(await snapshot(p._id), before);
                assert.doesNotMatch(JSON.stringify(logs), /private-password|postgresql|SQL|adapter/);
            });
            await t.test('late database uniqueness failure rolls back prior variant mutations and timestamps', async () => {
                const p = await make(); const before = await snapshot(p._id);
                const failed = await request('/' + p._id, 'PATCH', { code: first.code, name: 'Forbidden',
                    prices: [{ size: 'M', price: '50' }, { size: 'L', price: '60' }] });
                assert.deepEqual(failed, { status: 409, body: { error: 'Product code already exists' } });
                assert.deepEqual(await snapshot(p._id), before);
            });
            await t.test('concurrent duplicate POST and code PATCH have exactly one winner', async () => {
                const code = nextCode(); const data = { code, name: 'Race', category: prefix, prices: [{ size: 'S', price: '1' }] };
                const created = await Promise.all([request('', 'POST', data), request('', 'POST', data)]);
                assert.deepEqual(created.map(r => r.status).sort(), [201, 409]);
                assert.equal(await db.product.count({ where: { code } }), 1);
                const a = await make(), b = await make(), next = nextCode();
                const changed = await Promise.all([request('/' + a._id, 'PATCH', { code: next }), request('/' + b._id, 'PATCH', { code: next })]);
                assert.deepEqual(changed.map(r => r.status).sort(), [200, 409]);
                assert.equal(await db.product.count({ where: { code: next } }), 1);
            });
            await t.test('concurrent independent scalar PATCH operations preserve both fields', async () => {
                const p = await make();
                const results = await Promise.all([request('/' + p._id, 'PATCH', { name: ' Concurrent ' }), request('/' + p._id, 'PATCH', { description: ' Fresh ' })]);
                assert.ok(results.every(r => r.status === 200));
                const stored = (await request('/' + p._id)).body.data;
                assert.equal(stored.name, 'Concurrent'); assert.equal(stored.description, 'Fresh'); assert.deepEqual(stored.prices, p.prices);
            });
            await t.test('concurrent full-array replacements serialize and last successful writer wins', async () => {
                const p = await make(), entered = deferred(), release = deferred(); let pid;
                const originalM = (await snapshot(p._id)).variants.find(v => v.size === 'M').id;
                const delayed = interceptedClient(db, async context => {
                    if (context.model === 'product' && context.method === 'update') {
                        pid = (await context.tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                        entered.resolve(); await release.promise;
                    }
                    return context.run();
                });
                await withApi(createPostgresProductService(delayed), async slow => {
                    const a = slow('/' + p._id, 'PATCH', { name: 'First', prices: [{ size: 'M', price: '10' }, { size: 'L', price: '10' }] });
                    let b;
                    try {
                        await atGate(entered);
                        b = request('/' + p._id, 'PATCH', { name: 'Second', prices: [{ size: 'S', price: '20' }, { size: 'M', price: '20' }] });
                        await waitForBlocked(pid);
                    } finally { release.resolve(); }
                    assert.equal((await a).status, 200); assert.equal((await b).status, 200);
                });
                const stored = (await request('/' + p._id)).body.data;
                assert.equal(stored.name, 'Second'); assert.deepEqual(stored.prices, [{ size: 'S', price: '20' }, { size: 'M', price: '20' }]);
                assert.equal((await snapshot(p._id)).variants.find(v => v.size === 'M').id, originalM);
            });
            await t.test('Recipe insertion winning a real lock race prevents variant removal with 409', async () => {
                const p = await make(); const v = (await snapshot(p._id)).variants.find(v => v.size === 'M');
                const entered = deferred(), release = deferred(); let pid;
                const recipeId = randomUUID(); ownedRecipes.add(recipeId);
                const insertion = db.$transaction(async tx => {
                    pid = (await tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                    await tx.recipe.create({ data: { id: recipeId, productVariantId: v.id, version: 1 } });
                    entered.resolve(); await release.promise;
                }, { timeout: 10000 }).then(() => ({ success: true }), () => { entered.resolve(); return { success: false }; });
                let removal;
                try {
                    await atGate(entered);
                    removal = request('/' + p._id, 'PATCH', { name: 'Forbidden', prices: [{ size: 'S', price: '1' }] });
                    await waitForBlocked(pid);
                } finally { release.resolve(); }
                assert.equal((await insertion).success, true);
                assert.equal((await removal).status, 409);
                const after = await snapshot(p._id);
                assert.equal(after.product.name, p.name); assert.equal(after.variants.find(item => item.size === 'M').id, v.id);
                assert.equal(after.recipes[0].id, recipeId);
            });
            await t.test('variant removal winning a real lock race rejects concurrent Recipe insertion by FK', async () => {
                const p = await make(); const v = (await snapshot(p._id)).variants.find(v => v.size === 'M');
                const entered = deferred(), release = deferred(); let pid;
                const delayed = interceptedClient(db, async context => {
                    if (context.model === 'productVariant' && context.method === 'deleteMany') {
                        pid = (await context.tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                        entered.resolve(); await release.promise;
                    }
                    return context.run();
                });
                await withApi(createPostgresProductService(delayed), async slow => {
                    const removal = slow('/' + p._id, 'PATCH', { prices: [{ size: 'S', price: '1' }] });
                    let insertion;
                    try {
                        await atGate(entered);
                        const id = randomUUID(); ownedRecipes.add(id);
                        insertion = db.recipe.create({ data: { id, productVariantId: v.id, version: 1 } })
                            .then(() => ({ success: true }), e => ({ success: false, code: e.code }));
                        await waitForBlocked(pid);
                    } finally { release.resolve(); }
                    assert.equal((await removal).status, 200);
                    assert.deepEqual(await insertion, { success: false, code: 'P2003' });
                });
                assert.equal(await db.productVariant.count({ where: { id: v.id } }), 0);
                assert.equal(await db.recipe.count({ where: { productVariantId: v.id } }), 0);
            });
            await t.test('PATCH followed by blocked DELETE is atomic; repeated DELETE preserves full timestamps and codes', async () => {
                const p = await make(), entered = deferred(), release = deferred(); let pid;
                const delayed = interceptedClient(db, async context => {
                    if (context.model === 'product' && context.method === 'update') {
                        pid = (await context.tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                        entered.resolve(); await release.promise;
                    }
                    return context.run();
                });
                await withApi(createPostgresProductService(delayed), async slow => {
                    const patch = slow('/' + p._id, 'PATCH', { name: 'Before deletion', prices: [{ size: 'M', price: '5' }] }); let deletion;
                    try { await atGate(entered); deletion = request('/' + p._id, 'DELETE'); await waitForBlocked(pid); }
                    finally { release.resolve(); }
                    assert.equal((await patch).status, 200); assert.equal((await deletion).status, 200);
                });
                const deleted = await request('/' + p._id); const before = await snapshot(p._id);
                assert.equal(deleted.body.data.isAvailable, false); assert.equal(deleted.body.data.name, 'Before deletion');
                assert.deepEqual(deleted.body.data.prices, [{ size: 'M', price: '5' }]);
                const repeated = await Promise.all([request('/' + p._id, 'DELETE'), request('/' + p._id, 'DELETE')]);
                assert.deepEqual(repeated, [deleted, deleted]); assert.deepEqual(await snapshot(p._id), before);
                assert.equal((await request('', 'POST', { code: p.code, name: 'Duplicate', category: prefix, prices: [{ size: 'S', price: '1' }] })).status, 409);
                assert.equal((await request('/' + p._id, 'PATCH', { isAvailable: true })).body.data.isAvailable, true);
            });
            await t.test('Product/variant GET and list stay coherent across interleaved committed writes', async () => {
                const p = await make({ name: 'Old', prices: [{ size: 'S', price: '1' }] });
                for (const method of ['findUnique', 'findMany']) {
                    await request('/' + p._id, 'PATCH', { name: 'Old', prices: [{ size: 'S', price: '1' }] });
                    const entered = deferred(), release = deferred(); let intercepted = false;
                    const split = interceptedClient(db, async context => {
                        if (context.model === 'product' && context.method === method && !intercepted) {
                            intercepted = true;
                            const isolation = (await context.tx.$queryRaw`SHOW transaction_isolation`)[0].transaction_isolation;
                            assert.equal(isolation, 'repeatable read');
                            const args = { ...context.args[0] }; delete args.include;
                            const parents = await context.tx.product[method](args);
                            entered.resolve(); await release.promise;
                            const attach = async parent => ({ ...parent, variants: await context.tx.productVariant.findMany({ where: { productId: parent.id } }) });
                            return Array.isArray(parents) ? Promise.all(parents.map(attach)) : attach(parents);
                        }
                        return context.run();
                    });
                    await withApi(createPostgresProductService(split), async slow => {
                        const pending = slow(method === 'findUnique' ? '/' + p._id : `?category=${prefix}&search=${p.code}`);
                        try { await atGate(entered); assert.equal((await request('/' + p._id, 'PATCH', { name: 'New', prices: [{ size: 'S', price: '2' }] })).status, 200); }
                        finally { release.resolve(); }
                        const response = await pending;
                        assert.equal(response.status, 200);
                        const result = method === 'findUnique' ? response.body.data : response.body.data[0];
                        assert.equal(result.name, 'Old'); assert.deepEqual(result.prices, [{ size: 'S', price: '1' }]);
                    });
                }
            });
            await t.test('DELETE followed by blocked reactivating PATCH serializes without losing scalar or price changes', async () => {
                const p = await make(), entered = deferred(), release = deferred(); let pid;
                const delayed = interceptedClient(db, async context => {
                    if (context.model === 'product' && context.method === 'update') {
                        pid = (await context.tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                        entered.resolve(); await release.promise;
                    }
                    return context.run();
                });
                await withApi(createPostgresProductService(delayed), async slow => {
                    const deletion = slow('/' + p._id, 'DELETE'); let patch;
                    try {
                        await atGate(entered);
                        patch = request('/' + p._id, 'PATCH', { isAvailable: true, description: 'Reactivated', prices: [{ size: 'M', price: '7' }] });
                        await waitForBlocked(pid);
                    } finally { release.resolve(); }
                    assert.equal((await deletion).body.data.isAvailable, false);
                    assert.equal((await patch).body.data.isAvailable, true);
                });
                const stored = (await request('/' + p._id)).body.data;
                assert.equal(stored.isAvailable, true); assert.equal(stored.description, 'Reactivated');
                assert.deepEqual(stored.prices, [{ size: 'M', price: '7' }]);
            });
            await t.test('all four local store combinations use the selected HTTP contracts without cross-store writes', async () => {
                for (const ingredient of ['mongodb', 'postgres']) for (const product of ['mongodb', 'postgres']) {
                    Object.assign(process.env, { CATALOG_INGREDIENT_STORE: ingredient, CATALOG_PRODUCT_STORE: product });
                    const app = createApp(() => runtime.ready(), {
                        ...(ingredient === 'postgres' ? { postgresIngredients: createPostgresIngredientService(db) } : {}),
                        ...(product === 'postgres' ? { postgresProducts: service } : {}),
                    });
                    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
                    const url = `http://127.0.0.1:${app.server.address().port}`;
                    try {
                        const productResponse = await fetch(url + '/api/products/' + first._id);
                        const ingredientResponse = await fetch(url + '/api/ingredients/' + ingredientId);
                        assert.equal(productResponse.status, product === 'postgres' ? 200 : 400);
                        assert.equal(ingredientResponse.status, ingredient === 'postgres' ? 200 : 400);
                        const docs = await (await fetch(url + '/api-docs.json')).json();
                        assert.equal(docs.components.schemas.Product.properties.__v?.type, product === 'postgres' ? undefined : 'integer');
                        assert.equal(docs.components.schemas.Ingredient.properties.__v?.type, ingredient === 'postgres' ? undefined : 'integer');
                        assert.equal(docs.components.schemas.Recipe.properties.productId.pattern, '^[a-fA-F0-9]{24}$');
                    } finally { await new Promise(resolve => app.io.close(resolve)); }
                }
            });
            assert.equal((await fetch(base + '/health')).status, 200);
        });
    } finally {
        try {
            if (connected) {
                const cleanupGuard = await connectTestDatabase(process.env.TEST_DATABASE_URL); await cleanupGuard.end();
                await db.$transaction(async tx => {
                    const products = await tx.product.findMany({ where: { category: prefix, code: { in: [...ownedCodes] } }, select: { id: true } });
                    const ids = products.map(p => p.id);
                    const recipes = { id: { in: [...ownedRecipes] }, productVariant: { productId: { in: ids } } };
                    await tx.productVariant.updateMany({ where: { productId: { in: ids }, activeRecipeId: { in: [...ownedRecipes] } }, data: { activeRecipeId: null } });
                    await tx.recipeIngredient.deleteMany({ where: { recipe: recipes, ingredientId } });
                    await tx.recipe.deleteMany({ where: recipes });
                    await tx.productVariant.deleteMany({ where: { productId: { in: ids } } });
                    await tx.product.deleteMany({ where: { id: { in: ids }, category: prefix, code: { in: [...ownedCodes] } } });
                    await tx.ingredient.deleteMany({ where: { id: ingredientId, code: prefix + '_ING', category: prefix } });
                });
                assert.equal(await db.product.count({ where: { category: prefix } }), 0);
                assert.equal(await db.recipe.count({ where: { id: { in: [...ownedRecipes] } } }), 0);
                assert.equal(await db.ingredient.count({ where: { id: ingredientId } }), 0);
            }
        } finally {
            await runtime.close(); await observer.end();
            for (const [key, value] of Object.entries(beforeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
    }
});
