const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createApp } = require('../dist/app');
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });

async function withServer(ready, run) {
    const { server, io } = createApp(() => ready);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(url);
    } finally {
        await new Promise(resolve => io.close(resolve));
    }
}

test('compiled app serves status and Swagger without source-file scanning', async () => {
    await withServer(true, async url => {
        const status = await fetch(url);
        assert.equal(status.status, 200);
        assert.equal((await status.json()).status, 'success');
        const docs = await (await fetch(`${url}/api-docs.json`)).json();
        assert.equal(docs.openapi, '3.0.0');
        assert.ok(docs.paths['/'].get);
        assert.ok(docs.paths['/health'].get);
        assert.match(await (await fetch(`${url}/api-docs/`)).text(), /Swagger UI/);
    });
});

test('readiness reflects database availability', async () => {
    for (const ready of [true, false]) {
        await withServer(ready, async url => {
            const response = await fetch(`${url}/health`);
            assert.equal(response.status, ready ? 200 : 503);
            assert.deepEqual(await response.json(), { status: ready ? 'ok' : 'unavailable' });
        });
    }
});

test('bad JSON and unknown routes return JSON errors', async () => {
    await withServer(true, async url => {
        const bad = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
        });
        assert.equal(bad.status, 400);
        assert.deepEqual(await bad.json(), { error: 'Invalid request' });
        const missing = await fetch(`${url}/missing`);
        assert.equal(missing.status, 404);
        assert.deepEqual(await missing.json(), { error: 'Not found' });
    });
});

test('Socket.IO polling connects and relays inventory notifications', async () => {
    await withServer(true, async url => {
        const base = `${url}/socket.io/?EIO=4&transport=polling`;
        const open = await (await request(base)).text();
        assert.equal(open[0], '0');
        const { sid } = JSON.parse(open.slice(1));
        const session = `${base}&sid=${sid}`;
        const post = body => request(session, { method: 'POST', body });
        assert.equal((await post('40')).status, 200);
        assert.match(await (await request(session)).text(), /^40/);
        const inventory = { itemId: 'coffee', quantity: 5 };
        await post(`42${JSON.stringify(['update_inventory', inventory])}`);
        assert.deepEqual(JSON.parse((await (await request(session)).text()).slice(2)),
            ['inventory_changed', inventory]);
    });
});

test('invalid port fails startup instead of opening a named pipe', () => {
    const result = spawnSync(process.execPath, ['dist/server.js'], {
        env: { ...process.env, PORT: 'invalid' }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PORT must be an integer/);
});

test('readiness supports asynchronous PostgreSQL probes and sanitizes probe failures', async () => {
    const { server, io } = createApp(async () => { throw new Error('private connection details'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: 'unavailable' });
    } finally { await new Promise(resolve => io.close(resolve)); }
});

test('all four catalog selections compose independent routes and documentation', async () => {
    const before = { NODE_ENV: process.env.NODE_ENV, CATALOG_INGREDIENT_STORE: process.env.CATALOG_INGREDIENT_STORE, CATALOG_PRODUCT_STORE: process.env.CATALOG_PRODUCT_STORE };
    try {
        for (const ingredient of ['mongodb', 'postgres']) for (const product of ['mongodb', 'postgres']) {
            Object.assign(process.env, { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: ingredient, CATALOG_PRODUCT_STORE: product });
            const options = {
                ...(ingredient === 'postgres' ? { postgresIngredients: { getIngredient: async () => ({ marker: 'ingredient' }) } } : {}),
                ...(product === 'postgres' ? { postgresProducts: { getProduct: async () => ({ marker: 'product' }) } } : {}),
            };
            const { server, io } = createApp(() => true, options);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const base = `http://127.0.0.1:${server.address().port}`;
            try {
                const docs = await (await fetch(base + '/api-docs.json')).json();
                for (const [name, mode, path] of [['Ingredient', ingredient, 'ingredients'], ['Product', product, 'products']]) {
                    assert.equal(docs.components.schemas[name].properties.__v?.type, mode === 'postgres' ? undefined : 'integer');
                    const res = await fetch(base + '/api/' + path + '/11111111-1111-4111-8111-111111111111');
                    assert.equal(res.status, mode === 'postgres' ? 200 : 400);
                }
                assert.equal(docs.components.schemas.Recipe.properties.productId.pattern, '^[a-fA-F0-9]{24}$');
            } finally { await new Promise(resolve => io.close(resolve)); }
        }
        process.env.CATALOG_PRODUCT_STORE = 'postgres';
        assert.throws(() => createApp(() => true), /selection is incomplete/);
    } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
