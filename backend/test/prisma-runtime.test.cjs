const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { ingredientStore, postgresUrl } = require('../dist/config/postgres');
const { createPrismaRuntime } = require('../dist/db/prisma');
const fixture = 'postgresql://wavehouse_test:fixture@127.0.0.1:5433/wavehouse_test';
const config = () => ({ NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', TEST_DATABASE_URL: fixture });

test('Ingredient selection defaults to MongoDB and rejects unsupported or nonlocal opt-ins', () => {
    assert.equal(ingredientStore({}), 'mongodb');
    assert.equal(ingredientStore({ NODE_ENV: 'production' }), 'mongodb');
    for (const env of [{ CATALOG_INGREDIENT_STORE: '' }, { CATALOG_INGREDIENT_STORE: 'POSTGRES' },
        { CATALOG_INGREDIENT_STORE: 'postgres' }, { NODE_ENV: 'production', CATALOG_INGREDIENT_STORE: 'postgres' }]) assert.throws(() => ingredientStore(env));
    assert.equal(postgresUrl(config()), fixture);
    assert.equal(postgresUrl({ NODE_ENV: 'development', CATALOG_INGREDIENT_STORE: 'postgres', DATABASE_URL: fixture.replaceAll('wavehouse_test', 'wavehouse_dev') + '?schema=public' }).includes('wavehouse_dev'), true);
    for (const value of [undefined, 'postgresql://private-password', fixture.replace('127.0.0.1', 'example.com'),
        fixture.replace('5433', '5432'), fixture.replaceAll('wavehouse_test', 'wavehouse_dev'), fixture + '?schema=public', fixture + '#fragment', fixture.replace(':fixture@', '@')]) {
        assert.throws(() => postgresUrl({ ...config(), TEST_DATABASE_URL: value }), e => !e.message.includes('private-password') && !e.message.includes('postgresql://'));
    }
    assert.throws(() => postgresUrl({ ...config(), TEST_DATABASE_URL: undefined, DATABASE_URL: fixture }));
});

test('Prisma lifecycle verifies identity, sanitizes failures and disconnects after failed connect', async t => {
    const runtime = createPrismaRuntime(config());
    let closed = 0;
    runtime.client.$disconnect = async () => { closed++; };
    runtime.client.$connect = async () => { throw new Error('fixture secret URL'); };
    await assert.rejects(runtime.connect(), e => e.message === 'PostgreSQL connection or role isolation verification failed' && !e.cause);
    assert.equal(closed, 1);
    runtime.client.$queryRaw = async () => { throw new Error('fixture secret URL'); };
    assert.equal(await runtime.ready(), false);
    await runtime.close(); assert.equal(closed, 2);
});

test('Prisma lifecycle rejects live identity mismatches before application traffic', async t => {
    const runtime = createPrismaRuntime(config());
    runtime.client.$connect = async () => {};
    runtime.client.$disconnect = async () => {};
    runtime.client.$queryRaw = async () => [{ database: 'wavehouse_dev', role: 'wavehouse_dev' }];
    await assert.rejects(runtime.connect(), /isolation verification failed/);
});

test('compiled CommonJS imports perform no connections and production opt-in fails before startup', () => {
    const imported = spawnSync(process.execPath, ['-e', "require('./dist/app');require('./dist/server');require('./dist/db/prisma');console.log('imports passed')"], {
        encoding: 'utf8', timeout: 10000, env: { ...process.env, CATALOG_INGREDIENT_STORE: 'mongodb' },
    });
    assert.equal(imported.status, 0); assert.match(imported.stdout, /imports passed/);
    const rejected = spawnSync(process.execPath, ['dist/server.js'], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_ENV: 'production', CATALOG_INGREDIENT_STORE: 'postgres', DATABASE_URL: 'private-password' } });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /configuration or database unavailable/);
    assert.doesNotMatch(rejected.stderr, /private-password/);
});

test('compiled server preserves legacy startup and explicitly manages local PostgreSQL lifecycle', async t => {
    const mongoose = require('mongoose');
    const net = require('node:net');
    const runtimeModule = require('../dist/db/prisma');
    const { startServer } = require('../dist/server');
    const events = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(mongoose, 'connect', async () => { events.push('mongo connect'); return mongoose; });
    t.mock.method(mongoose, 'disconnect', async () => { events.push('mongo close'); });
    const runtimeFactory = t.mock.method(runtimeModule, 'createPrismaRuntime', () => ({ client: {},
        connect: async () => { events.push('postgres connect'); }, close: async () => { events.push('postgres close'); }, ready: async () => true }));
    const keys = ['NODE_ENV', 'CATALOG_INGREDIENT_STORE', 'PORT', 'DATABASE_URL', 'TEST_DATABASE_URL', 'SHADOW_DATABASE_URL'];
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        for (const mode of ['mongodb', 'postgres']) {
            events.length = 0;
            const probe = net.createServer();
            await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
            const port = probe.address().port;
            await new Promise(resolve => probe.close(resolve));
            process.env.PORT = String(port); process.env.NODE_ENV = 'test'; process.env.CATALOG_INGREDIENT_STORE = mode;
            const beforeTerm = process.listeners('SIGTERM'); const beforeInt = process.listeners('SIGINT');
            const server = await startServer();
            try {
                assert.equal(server.listening, true);
                if (mode === 'mongodb') {
                    assert.deepEqual(events, ['mongo connect']); assert.equal(runtimeFactory.mock.callCount(), 0);
                } else {
                    assert.deepEqual(events, ['postgres connect', 'mongo connect']);
                    assert.equal(server.address().address, '127.0.0.1');
                }
                const health = await fetch(`http://127.0.0.1:${port}/health`);
                assert.equal(health.status, 503, 'PostgreSQL mode still requires actual MongoDB readiness');
            } finally {
                const shutdown = process.listeners('SIGTERM').find(fn => !beforeTerm.includes(fn));
                const closed = new Promise(resolve => server.once('close', resolve));
                shutdown(); await closed; await new Promise(resolve => setImmediate(resolve));
                for (const fn of process.listeners('SIGTERM')) if (!beforeTerm.includes(fn)) process.removeListener('SIGTERM', fn);
                for (const fn of process.listeners('SIGINT')) if (!beforeInt.includes(fn)) process.removeListener('SIGINT', fn);
            }
            assert.ok(events.includes('mongo close'));
            assert.equal(events.includes('postgres close'), mode === 'postgres');
        }
    } finally {
        for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
