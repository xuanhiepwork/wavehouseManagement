const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connectTestDatabase } = require('../scripts/test-postgres.cjs');
const { createPrismaRuntime } = require('../dist/db/prisma');
const { createPostgresRecipeService, verifyRecipeFoundation } = require('../dist/services/recipe.postgres.service');
const { createPostgresProductService } = require('../dist/services/product.postgres.service');
const { createPostgresIngredientService } = require('../dist/services/ingredient.postgres.service');
const { createApp } = require('../dist/app');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function atGate(gate) {
    let timer;
    try { return await Promise.race([gate.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scheduling gate not reached')), 2500); })]); }
    finally { clearTimeout(timer); }
}
// Hooks wrap real transactions for controlled scheduling/failures, not production settings.
function interceptedClient(db, hook) {
    return new Proxy(db, { get(target, key) {
        if (key !== '$transaction') return target[key];
        return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, { get(connection, model) {
            if (model === '$queryRaw') return (...args) => hook({ tx, model: 'raw', method: 'query', args, run: () => connection.$queryRaw(...args) });
            if (!['recipe', 'recipeIngredient', 'productVariant', 'product', 'ingredient'].includes(model)) return connection[model];
            return new Proxy(connection[model], { get(delegate, method) {
                if (typeof delegate[method] !== 'function') return delegate[method];
                return (...args) => hook({ tx, model, method, args, run: () => delegate[method](...args) });
            } });
        } })), options);
    } });
}

test('PostgreSQL Recipe HTTP API: versions, pointer races, integrity, snapshots and isolated cleanup', {
    skip: !process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not configured' : false, timeout: 120000,
}, async t => {
    const observer = await connectTestDatabase(process.env.TEST_DATABASE_URL);
    const environment = { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL };
    const runtime = createPrismaRuntime(environment), db = runtime.client;
    const prefix = 'PG_REC_' + randomUUID().replaceAll('-', '').toUpperCase();
    const codes = new Set(); let next = 0, connected = false;
    const ingredientIds = [randomUUID(), randomUUID()].sort();
    const keys = ['NODE_ENV', 'CATALOG_INGREDIENT_STORE', 'CATALOG_PRODUCT_STORE', 'CATALOG_RECIPE_STORE'];
    const beforeEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
    const call = async (base, path, method = 'GET', body) => {
        const res = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
        return { status: res.status, body: await res.json() };
    };
    async function withApi(recipeDb, callback, overrides = {}) {
        const app = createApp(() => runtime.ready(), { postgresIngredients: createPostgresIngredientService(overrides.ingredient ?? db),
            postgresProducts: createPostgresProductService(overrides.product ?? db), postgresRecipes: createPostgresRecipeService(recipeDb) });
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}`;
        try { return await callback((path = '', method = 'GET', body) => call(base, '/api/recipes' + path, method, body), base); }
        finally { await new Promise(resolve => app.io.close(resolve)); }
    }
    async function product(sizes = ['S', 'M', 'L']) {
        const code = `${prefix}_${++next}`; codes.add(code);
        return db.product.create({ data: { code, name: 'Recipe fixture', category: prefix,
            variants: { create: sizes.map(size => ({ size, price: '1' })) } }, include: { variants: true } });
    }
    const body = (p, size = 'M') => ({ productId: p.id, size, ingredients: [...ingredientIds].reverse().map((ingredientId, i) => ({ ingredientId, quantity: i ? '999999999999.123456' : '0.000001' })) });
    async function snapshot(id) {
        return (await db.$queryRaw`SELECT jsonb_build_object('product',to_jsonb(p),
            'variants',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM product_variants v WHERE v.product_id=p.id),'[]'::jsonb),
            'recipes',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM recipes r JOIN product_variants v ON v.id=r.product_variant_id WHERE v.product_id=p.id),'[]'::jsonb),
            'memberships',COALESCE((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id) FROM recipe_ingredients ri JOIN recipes r ON r.id=ri.recipe_id JOIN product_variants v ON v.id=r.product_variant_id WHERE v.product_id=p.id),'[]'::jsonb)) AS snapshot
            FROM products p WHERE p.id=${id}::uuid`)[0]?.snapshot;
    }
    async function waitForBlocked(pid) {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
            if ((await observer.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                AND usename=current_user AND $1=ANY(pg_blocking_pids(pid))) blocked`, [pid])).rows[0].blocked) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail('Expected real PostgreSQL lock wait was not observed');
    }
    function delayed(model, method, after = false) {
        const entered = deferred(), release = deferred(); let pid;
        const client = interceptedClient(db, async context => {
            if (context.model === model && context.method === method) {
                const result = after ? await context.run() : undefined;
                pid = (await context.tx.$queryRaw`SELECT pg_backend_pid() pid`)[0].pid;
                entered.resolve(); await release.promise;
                return after ? result : context.run();
            }
            return context.run();
        });
        return { client, entered, release, pid: () => pid };
    }
    const content = s => ({ recipes: s.recipes.map(({ updated_at, ...rest }) => rest), memberships: s.memberships });
    try {
        await runtime.connect(); connected = true;
        Object.assign(process.env, { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres' });
        await db.$transaction(tx => verifyRecipeFoundation(tx));
        for (const [i, id] of ingredientIds.entries()) await db.ingredient.create({ data: { id, code: `${prefix}_I${i}`, name: 'Recipe ingredient', category: prefix, unit: 'g', costPrice: '0' } });
        await withApi(db, async (request, base) => {
            const create = async (p, size = 'M') => { const res = await request('', 'POST', body(p, size)); assert.equal(res.status, 201); return res.body.data; };
            await t.test('atomic HTTP creation uses UUIDs, canonical quantities, inactive defaults and ordered memberships', async () => {
                const p = await product(), a = await create(p), b = await create(p), s = await create(p, 'S');
                assert.deepEqual([a.version, b.version, s.version], [1, 2, 1]);
                assert.equal(a.productId, p.id); assert.equal(a.size, 'M'); assert.equal(a.isActive, false); assert.equal(a.__v, undefined);
                assert.match(a._id, /^[a-f\d-]{36}$/); assert.deepEqual(a.ingredients.map(i => i.ingredientId), ingredientIds);
                assert.equal(a.ingredients[0].quantity, '999999999999.123456'); assert.equal(a.ingredients[1].quantity, '0.000001');
                assert.ok(a.ingredients.every(item => Object.keys(item).sort().join() === 'ingredientId,quantity'));
                const stored = await snapshot(p.id); assert.equal(stored.recipes.length, 3); assert.equal(stored.memberships.length, 6);
            });
            await t.test('invalid quantities/protected fields/duplicate UUIDs/actions fail before mutation and history has no PATCH/DELETE', async () => {
                const p = await product(), r = await create(p), before = await snapshot(p.id);
                for (const changed of [{ ingredients: [] }, { version: 7 }, { isActive: true }, { productVariantId: p.variants[0].id },
                    { ingredients: [{ ingredientId: ingredientIds[0], quantity: '0' }] }, { ingredients: [{ ingredientId: ingredientIds[0], quantity: '1.0000000' }] },
                    { ingredients: [{ ingredientId: ingredientIds[0], quantity: '0.0000001' }] }, { ingredients: [{ ingredientId: ingredientIds[0], quantity: '1000000000000' }] },
                    { ingredients: [{ ingredientId: ingredientIds[0], quantity: 999999999999.99 }] },
                    { ingredients: [{ ingredientId: ingredientIds[0], quantity: 1 }, { ingredientId: ingredientIds[0].toUpperCase(), quantity: 2 }] }]) {
                    assert.equal((await request('', 'POST', { ...body(p), ...changed })).status, 400);
                }
                assert.equal((await request('?page=1', 'POST', body(p))).status, 400);
                for (const action of ['activate', 'deactivate']) {
                    assert.equal((await request('/' + r._id + '/' + action, 'POST', { isActive: true })).status, 400);
                    assert.equal((await request('/' + r._id + '/' + action + '?unknown=1', 'POST')).status, 400);
                    assert.equal((await request('/' + randomUUID() + '/' + action, 'POST')).status, 404);
                }
                assert.equal((await request('/0123456789abcdef01234567')).status, 400);
                for (const method of ['PATCH', 'DELETE']) assert.equal((await request('/' + r._id, method, {})).status, 404);
                assert.deepEqual(await snapshot(p.id), before);
            });
            await t.test('missing references return 404, unsupported size 409, and inactive/unavailable drafts remain allowed', async () => {
                const p = await product(['M']);
                assert.equal((await request('', 'POST', { ...body(p), productId: randomUUID() })).status, 404);
                assert.equal((await request('', 'POST', { ...body(p), ingredients: [{ ingredientId: randomUUID(), quantity: '1' }] })).status, 404);
                assert.equal((await request('', 'POST', body(p, 'S'))).status, 409);
                await call(base, '/api/products/' + p.id, 'DELETE');
                await call(base, '/api/ingredients/' + ingredientIds[0], 'DELETE');
                try {
                    const r = await create(p); assert.equal(r.isActive, false);
                    const before = await snapshot(p.id);
                    assert.equal((await request('/' + r._id + '/activate', 'POST')).status, 409);
                    assert.deepEqual(await snapshot(p.id), before);
                } finally { await call(base, '/api/ingredients/' + ingredientIds[0], 'PATCH', { isActive: true }); }
            });
            await t.test('integer boundary is checked before writes and SQL-created empty drafts remain readable but cannot activate', async () => {
                const p = await product(['M']); const v = p.variants[0];
                await db.recipe.create({ data: { productVariantId: v.id, version: 2147483646, ingredients: { create: { ingredientId: ingredientIds[0], quantity: '1' } } } });
                assert.equal((await create(p)).version, 2147483647);
                const before = await snapshot(p.id);
                assert.deepEqual(await request('', 'POST', body(p)), { status: 500, body: { error: 'Internal server error' } });
                assert.deepEqual(await snapshot(p.id), before);
                const other = await product(['M']);
                const empty = await db.recipe.create({ data: { productVariantId: other.variants[0].id, version: 1 } });
                assert.deepEqual((await request('/' + empty.id)).body.data.ingredients, []);
                const emptyBefore = await snapshot(other.id);
                assert.deepEqual(await request('/' + empty.id + '/activate', 'POST'), { status: 409, body: { error: 'Recipe has no ingredients' } });
                assert.deepEqual(await snapshot(other.id), emptyBefore);
            });
            await t.test('concurrent first and later creation serializes on the variant and leaves independent sizes available', async () => {
                for (const initial of [0, 1]) {
                    const p = await product(); if (initial) await create(p);
                    const gate = delayed('recipe', 'create', true);
                    await withApi(gate.client, async slow => {
                        const first = slow('', 'POST', body(p)); let second;
                        try {
                            await atGate(gate.entered);
                            second = request('', 'POST', body(p)); await waitForBlocked(gate.pid());
                            assert.equal((await create(p, 'S')).version, 1, 'Different variants must retain independent version sequences');
                        } finally { gate.release.resolve(); }
                        assert.deepEqual([(await first).body.data.version, (await second).body.data.version], [initial + 1, initial + 2]);
                    });
                    const stored = await snapshot(p.id);
                    assert.equal(stored.recipes.length, initial + 3); assert.equal(stored.memberships.length, 2 * (initial + 3));
                }
            });
            await t.test('activation switching touches only changed Recipes and repeated/stale actions preserve full timestamps', async () => {
                const p = await product(), a = await create(p), b = await create(p), before = await snapshot(p.id);
                assert.equal((await request('/' + a._id + '/activate', 'POST')).body.data.isActive, true);
                const activeA = await snapshot(p.id);
                assert.notEqual(activeA.recipes.find(r => r.id === a._id).updated_at, before.recipes.find(r => r.id === a._id).updated_at);
                assert.equal(activeA.recipes.find(r => r.id === b._id).updated_at, before.recipes.find(r => r.id === b._id).updated_at);
                assert.equal((await request('/' + a._id + '/activate', 'POST', {})).status, 200); assert.deepEqual(await snapshot(p.id), activeA);
                assert.equal((await request('/' + b._id + '/activate', 'POST')).body.data.isActive, true);
                const activeB = await snapshot(p.id);
                for (const id of [a._id, b._id]) assert.notEqual(activeB.recipes.find(r => r.id === id).updated_at, activeA.recipes.find(r => r.id === id).updated_at);
                assert.deepEqual(content(activeB), content(before)); assert.deepEqual(activeB.product, before.product);
                assert.equal((await request('/' + a._id)).body.data.isActive, false);
                assert.equal((await request('/' + a._id + '/deactivate', 'POST')).body.data.isActive, false); assert.deepEqual(await snapshot(p.id), activeB);
                assert.equal((await request('/' + b._id + '/deactivate', 'POST')).body.data.isActive, false);
                const inactive = await snapshot(p.id);
                await request('/' + b._id + '/deactivate', 'POST', {}); assert.deepEqual(await snapshot(p.id), inactive);
                assert.deepEqual(content(inactive), content(before));
            });
            await t.test('concurrent first activation and competing switches permit exactly one active pointer', async () => {
                for (const initiallyActive of [false, true]) {
                    const p = await product(), old = await create(p), a = await create(p), b = await create(p);
                    if (initiallyActive) await request('/' + old._id + '/activate', 'POST');
                    const gate = delayed('productVariant', 'update');
                    await withApi(gate.client, async slow => {
                        const first = slow('/' + a._id + '/activate', 'POST'); let second;
                        try { await atGate(gate.entered); second = request('/' + b._id + '/activate', 'POST'); await waitForBlocked(gate.pid()); }
                        finally { gate.release.resolve(); }
                        assert.equal((await first).body.data.isActive, true); assert.equal((await second).body.data.isActive, true);
                    });
                    const active = await request(`?productId=${p.id}&isActive=true`);
                    assert.deepEqual(active.body.data.map(r => r._id), [b._id]);
                    assert.equal((await request(`?productId=${p.id}&isActive=false`)).body.pagination.total, 2);
                }
            });
            await t.test('deactivation before switching and delayed stale deactivation after switching are safe', async () => {
                for (const deactivateFirst of [true, false]) {
                    const p = await product(), a = await create(p), b = await create(p);
                    await request('/' + a._id + '/activate', 'POST');
                    const gate = delayed('productVariant', deactivateFirst ? 'updateMany' : 'update');
                    await withApi(gate.client, async slow => {
                        const first = slow('/' + (deactivateFirst ? a._id + '/deactivate' : b._id + '/activate'), 'POST'); let second;
                        try { await atGate(gate.entered); second = request('/' + (deactivateFirst ? b._id + '/activate' : a._id + '/deactivate'), 'POST'); await waitForBlocked(gate.pid()); }
                        finally { gate.release.resolve(); }
                        assert.equal((await first).status, 200); assert.equal((await second).status, 200);
                    });
                    assert.equal((await request('/' + b._id)).body.data.isActive, true);
                    const before = await snapshot(p.id); await request('/' + a._id + '/deactivate', 'POST'); assert.deepEqual(await snapshot(p.id), before);
                }
            });
            await t.test('activation versus Product and Ingredient deactivation uses observed lock waits in both orders', async () => {
                for (const catalog of ['product', 'ingredient']) for (const activationFirst of [true, false]) {
                    const p = await product(), r = await create(p);
                    const path = catalog === 'product' ? '/api/products/' + p.id : '/api/ingredients/' + ingredientIds[0];
                    const gate = activationFirst ? delayed('productVariant', 'update') : delayed(catalog, 'update', true);
                    try {
                        await withApi(activationFirst ? gate.client : db, async (slow, slowBase) => {
                            const first = activationFirst ? slow('/' + r._id + '/activate', 'POST') : call(slowBase, path, 'DELETE'); let second;
                            try {
                                await atGate(gate.entered);
                                second = activationFirst ? call(base, path, 'DELETE') : request('/' + r._id + '/activate', 'POST');
                                await waitForBlocked(gate.pid());
                            } finally { gate.release.resolve(); }
                            assert.equal((await first).status, 200); assert.equal((await second).status, activationFirst ? 200 : 409);
                        }, activationFirst ? {} : { [catalog]: gate.client });
                        assert.equal((await request('/' + r._id)).body.data.isActive, activationFirst);
                        const before = await snapshot(p.id);
                        assert.equal((await request('/' + r._id + '/activate', 'POST')).status, 409, 'Even already-active Recipes must be revalidated');
                        assert.deepEqual(await snapshot(p.id), before);
                        assert.equal((await request('/' + r._id + '/deactivate', 'POST')).status, 200, 'Deactivation does not require availability');
                    } finally { if (catalog === 'ingredient') await call(base, path, 'PATCH', { isActive: true }); }
                }
            });
            await t.test('Recipe creation winning a variant-removal race preserves history and rejects Product PATCH', async () => {
                const p = await product(['S', 'M']), gate = delayed('recipe', 'create', true);
                await withApi(gate.client, async slow => {
                    const creation = slow('', 'POST', body(p)); let removal;
                    try {
                        await atGate(gate.entered);
                        removal = call(base, '/api/products/' + p.id, 'PATCH', { name: 'Forbidden', prices: [{ size: 'S', price: '1' }] });
                        await waitForBlocked(gate.pid());
                    } finally { gate.release.resolve(); }
                    assert.equal((await creation).status, 201); assert.equal((await removal).status, 409);
                });
                const stored = await snapshot(p.id); assert.equal(stored.product.name, p.name); assert.equal(stored.variants.length, 2); assert.equal(stored.recipes.length, 1);
            });
            await t.test('Product variant removal winning a creation race yields 409 with no orphan Recipe/memberships', async () => {
                const p = await product(['S', 'M']), gate = delayed('productVariant', 'deleteMany', true);
                await withApi(db, async (_, slowBase) => {
                    const removal = call(slowBase, '/api/products/' + p.id, 'PATCH', { prices: [{ size: 'S', price: '1' }] }); let creation;
                    try { await atGate(gate.entered); creation = request('', 'POST', body(p)); await waitForBlocked(gate.pid()); }
                    finally { gate.release.resolve(); }
                    assert.equal((await removal).status, 200); assert.equal((await creation).status, 409);
                }, { product: gate.client });
                const stored = await snapshot(p.id); assert.equal(stored.recipes.length, 0); assert.equal(stored.memberships.length, 0); assert.deepEqual(stored.variants.map(v => v.size), ['S']);
            });
            await t.test('rollback after partial memberships, complete creation, pointer switch and Recipe timestamps is atomic', async () => {
                for (const partial of [true, false]) {
                    const p = await product(), before = await snapshot(p.id);
                    const broken = interceptedClient(db, async context => {
                        if (context.model === 'recipe' && context.method === 'create') {
                            if (partial) {
                                const { ingredients, ...fields } = context.args[0].data;
                                const recipe = await context.tx.recipe.create({ ...context.args[0], data: fields });
                                await context.tx.recipeIngredient.create({ data: { recipeId: recipe.id, ...ingredients.create[0] } });
                            } else await context.run();
                            throw new Error('private-password after Recipe creation');
                        }
                        return context.run();
                    });
                    await withApi(broken, async failing => assert.deepEqual(await failing('', 'POST', body(p)), { status: 500, body: { error: 'Internal server error' } }));
                    assert.deepEqual(await snapshot(p.id), before);
                }
                const p = await product(), a = await create(p), b = await create(p); await request('/' + a._id + '/activate', 'POST');
                for (const action of ['activate', 'deactivate']) {
                    const before = await snapshot(p.id);
                    const broken = interceptedClient(db, async context => {
                        const result = await context.run();
                        if (context.model === 'recipe' && context.method === (action === 'activate' ? 'updateMany' : 'update')) throw new Error('private-password after timestamp mutation');
                        return result;
                    });
                    await withApi(broken, async failing => assert.equal((await failing('/' + (action === 'activate' ? b._id : a._id) + '/' + action, 'POST')).status, 500));
                    assert.deepEqual(await snapshot(p.id), before);
                }
                assert.doesNotMatch(JSON.stringify(logs), /private-password|postgresql|SQL|adapter/);
            });
            await t.test('fault-injected post-commit failure returns 500 without retry or a false rollback claim (not a network-failure test)', async () => {
                const p = await product(); let attempts = 0;
                const uncertain = new Proxy(db, { get(target, key) {
                    if (key !== '$transaction') return target[key];
                    return async (...args) => { attempts++; await target.$transaction(...args); throw new Error('private-password synthetic lost commit acknowledgement'); };
                } });
                await withApi(uncertain, async failing => assert.deepEqual(await failing('', 'POST', body(p)), { status: 500, body: { error: 'Internal server error' } }));
                assert.equal(attempts, 1); const stored = await snapshot(p.id); assert.equal(stored.recipes.length, 1); assert.equal(stored.memberships.length, 2);
            });
            await t.test('foundation metadata failures fail before writes without schema repair or DDL', async () => {
                const p = await product(); const before = await snapshot(p.id);
                for (const source of ['pg_constraint', 'pg_index', 'pg_trigger']) {
                    const broken = interceptedClient(db, async context => {
                        const rows = await context.run();
                        const text = context.model === 'raw' ? (Array.isArray(context.args[0]) ? context.args[0].join('') : context.args[0]?.sql ?? '') : '';
                        return text.includes('FROM ' + source) ? [] : rows;
                    });
                    await withApi(broken, async failing => assert.equal((await failing('', 'POST', body(p))).status, 500));
                    assert.deepEqual(await snapshot(p.id), before);
                }
                await db.$transaction(tx => verifyRecipeFoundation(tx));
            });
            await t.test('filters, lexical L/M/S ordering, pagination, quantities and coherent pointer snapshots are correct', async () => {
                const p = await product(); const records = [];
                for (const size of ['S', 'M', 'L']) { records.push(await create(p, size)); records.push(await create(p, size)); }
                const one = await request(`?productId=${p.id}&limit=3&page=1`), two = await request(`?productId=${p.id}&limit=3&page=2`);
                assert.equal(one.body.pagination.total, 6);
                const all = [...one.body.data, ...two.body.data];
                assert.deepEqual(all.map(r => r.size), ['L', 'L', 'M', 'M', 'S', 'S']); assert.deepEqual(all.map(r => r.version), [2, 1, 2, 1, 2, 1]);
                const target = records.find(r => r.size === 'M'); await request('/' + target._id + '/activate', 'POST');
                assert.equal((await request(`?productId=${p.id}&size=M&isActive=true`)).body.pagination.total, 1);
                assert.equal((await request(`?productId=${p.id}&size=M&isActive=false`)).body.pagination.total, 1);
                for (const method of ['findUnique', 'findMany']) {
                    await request('/' + target._id + '/activate', 'POST');
                    const entered = deferred(), release = deferred(); let used = false;
                    const split = interceptedClient(db, async context => {
                        if (context.model === 'recipe' && context.method === method && context.args[0].include && !used) {
                            used = true;
                            assert.equal((await context.tx.$queryRaw`SHOW transaction_isolation`)[0].transaction_isolation, 'repeatable read');
                            const args = { ...context.args[0] }; delete args.include;
                            const parents = await context.tx.recipe[method](args);
                            entered.resolve(); await release.promise;
                            const attach = async row => ({ ...row, ingredients: await context.tx.recipeIngredient.findMany({ where: { recipeId: row.id } }),
                                productVariant: await context.tx.productVariant.findUnique({ where: { id: row.productVariantId } }) });
                            return Array.isArray(parents) ? Promise.all(parents.map(attach)) : attach(parents);
                        }
                        return context.run();
                    });
                    await withApi(split, async slow => {
                        const pending = slow(method === 'findUnique' ? '/' + target._id : `?productId=${p.id}&size=M&isActive=true`);
                        try { await atGate(entered); assert.equal((await request('/' + target._id + '/deactivate', 'POST')).status, 200); }
                        finally { release.resolve(); }
                        const response = await pending; assert.equal(response.status, 200);
                        const result = method === 'findUnique' ? response.body.data : response.body.data[0]; assert.equal(result.isActive, true);
                    });
                }
            });
            await t.test('restrictive foreign keys preserve Recipe history and membership references', async () => {
                const p = await product(), r = await create(p); await request('/' + r._id + '/activate', 'POST');
                const before = await snapshot(p.id); const v = p.variants.find(v => v.size === 'M');
                for (const work of [() => db.ingredient.delete({ where: { id: ingredientIds[0] } }), () => db.product.delete({ where: { id: p.id } }),
                    () => db.productVariant.delete({ where: { id: v.id } }), () => db.recipe.delete({ where: { id: r._id } })]) {
                    await assert.rejects(work(), e => e.code === 'P2003');
                }
                assert.deepEqual(await snapshot(p.id), before);
            });
            await t.test('five valid and three invalid store configurations retain selected HTTP contracts', async () => {
                const p = await product(), r = await create(p); let valid = 0, invalid = 0;
                for (const ingredient of ['mongodb', 'postgres']) for (const productStore of ['mongodb', 'postgres']) for (const recipe of ['mongodb', 'postgres']) {
                    Object.assign(process.env, { CATALOG_INGREDIENT_STORE: ingredient, CATALOG_PRODUCT_STORE: productStore, CATALOG_RECIPE_STORE: recipe });
                    const options = { ...(ingredient === 'postgres' ? { postgresIngredients: createPostgresIngredientService(db) } : {}),
                        ...(productStore === 'postgres' ? { postgresProducts: createPostgresProductService(db) } : {}),
                        ...(recipe === 'postgres' ? { postgresRecipes: createPostgresRecipeService(db) } : {}) };
                    if (recipe === 'postgres' && (ingredient !== 'postgres' || productStore !== 'postgres')) { assert.throws(() => createApp(() => true, options)); invalid++; continue; }
                    valid++; const app = createApp(() => runtime.ready(), options); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
                    const url = `http://127.0.0.1:${app.server.address().port}`;
                    try {
                        assert.equal((await call(url, '/api/recipes/' + r._id)).status, recipe === 'postgres' ? 200 : 400);
                        const docs = (await call(url, '/api-docs.json')).body;
                        for (const [name, mode] of [['Ingredient', ingredient], ['Product', productStore], ['Recipe', recipe]]) assert.equal(docs.components.schemas[name].properties.__v?.type, mode === 'postgres' ? undefined : 'integer');
                    } finally { await new Promise(resolve => app.io.close(resolve)); }
                }
                assert.equal(valid, 5); assert.equal(invalid, 3);
            });
        });
    } finally {
        try {
            if (connected) {
                const guard = await connectTestDatabase(process.env.TEST_DATABASE_URL); await guard.end();
                await db.$transaction(async tx => {
                    const parents = await tx.product.findMany({ where: { category: prefix, code: { in: [...codes] } }, select: { id: true } });
                    const ids = parents.map(p => p.id); const recipes = { productVariant: { productId: { in: ids } } };
                    await tx.productVariant.updateMany({ where: { productId: { in: ids } }, data: { activeRecipeId: null } });
                    await tx.recipeIngredient.deleteMany({ where: { recipe: recipes, ingredientId: { in: ingredientIds } } });
                    await tx.recipe.deleteMany({ where: recipes }); await tx.productVariant.deleteMany({ where: { productId: { in: ids } } });
                    await tx.product.deleteMany({ where: { id: { in: ids }, category: prefix, code: { in: [...codes] } } });
                    await tx.ingredient.deleteMany({ where: { id: { in: ingredientIds }, category: prefix, code: { in: ingredientIds.map((_, i) => `${prefix}_I${i}`) } } });
                });
                assert.equal(await db.product.count({ where: { category: prefix } }), 0);
                assert.equal(await db.ingredient.count({ where: { id: { in: ingredientIds } } }), 0);
            }
        } finally {
            await runtime.close(); await observer.end();
            for (const [key, value] of Object.entries(beforeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
    }
});
