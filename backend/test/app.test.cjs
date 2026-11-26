const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createApp } = require('../dist/app');
const options = () => ({ authPrisma: {}, postgresIngredients: {}, postgresProducts: {}, postgresRecipes: {} });
async function withServer(probe, run) {
    const { server, io } = createApp(probe, options());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => io.close(resolve)); }
}
test('compiled PostgreSQL app serves status, UUID documentation and Swagger', async () => {
    await withServer(() => true, async url => {
        assert.equal((await (await fetch(url)).json()).status, 'success');
        const docs = await (await fetch(url + '/api-docs.json')).json();
        for (const name of ['Ingredient', 'Product', 'Recipe']) {
            assert.equal(docs.components.schemas[name].properties._id.format, 'uuid');
            assert.equal(docs.components.schemas[name].properties.__v, undefined);
        }
        assert.match(await (await fetch(url + '/api-docs/')).text(), /Swagger UI/);
    });
});
test('readiness checks asynchronous probes and sanitizes failures', async () => {
    for (const [probe, code] of [[async () => true, 200], [async () => false, 503], [async () => { throw Error('private details'); }, 503]]) {
        await withServer(probe, async url => {
            const res = await fetch(url + '/health');
            assert.equal(res.status, code);
            assert.deepEqual(await res.json(), { status: code === 200 ? 'ok' : 'unavailable' });
        });
    }
});
test('parser and missing route errors retain JSON contracts', async () => {
    await withServer(() => true, async url => {
        const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: 'Invalid request' });
        const missing = await fetch(url + '/missing');
        assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { error: 'Not found' });
    });
});
test('Socket.IO retains existing notification relay', async () => {
    await withServer(() => true, async url => {
        const request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
        const base = url + '/socket.io/?EIO=4&transport=polling';
        const open = await (await request(base)).text();
        const { sid } = JSON.parse(open.slice(1)), session = `${base}&sid=${sid}`;
        await request(session, { method: 'POST', body: '40' });
        assert.match(await (await request(session)).text(), /^40/);
        const inventory = { itemId: 'coffee', quantity: 5 };
        await request(session, { method: 'POST', body: `42${JSON.stringify(['update_inventory', inventory])}` });
        assert.deepEqual(JSON.parse((await (await request(session)).text()).slice(2)), ['inventory_changed', inventory]);
    });
});
test('authentication and complete PostgreSQL dependencies are mandatory', () => {
    assert.throws(() => createApp(), /authentication dependency/);
    assert.throws(() => createApp(() => true, { authPrisma: {} }), /selection is incomplete/);
});
test('invalid port fails before resource allocation', () => {
    const result = spawnSync(process.execPath, ['dist/server.js'], {
        env: { ...process.env, NODE_ENV: 'test', PORT: 'invalid' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /PORT must be an integer/);
});
