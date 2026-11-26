const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { ingredientStore, productStore, recipeStore, postgresUrl } = require('../dist/config/postgres');
const { createPrismaRuntime } = require('../dist/db/prisma');
const fixture = 'postgresql://wavehouse_test:fixture@127.0.0.1:5433/wavehouse_test';
const config = () => ({ NODE_ENV: 'test', TEST_DATABASE_URL: fixture });
test('PostgreSQL defaults and local/test URL isolation reject legacy and unsafe targets', () => {
    for (const [select, key] of [[ingredientStore, 'CATALOG_INGREDIENT_STORE'], [productStore, 'CATALOG_PRODUCT_STORE'], [recipeStore, 'CATALOG_RECIPE_STORE']]) {
        assert.equal(select({}), 'postgres'); assert.equal(select({ [key]: 'postgres' }), 'postgres');
        for (const mode of ['mongodb', '', 'unknown']) assert.throws(() => select({ [key]: mode }), /must be postgres/);
    }
    assert.equal(postgresUrl(config()), fixture);
    for (const value of [undefined, 'postgresql://private-password', fixture.replace('127.0.0.1', 'example.com'), fixture.replace('5433', '5432'), fixture.replaceAll('wavehouse_test', 'wavehouse_dev'), fixture + '?schema=public', fixture + '#fragment', fixture.replace(':fixture@', '@')]) {
        assert.throws(() => postgresUrl({ ...config(), TEST_DATABASE_URL: value }), e => !e.message.includes('private-password') && !e.message.includes('postgresql://'));
    }
    assert.throws(() => postgresUrl({ ...config(), TEST_DATABASE_URL: undefined, DATABASE_URL: fixture }));
    assert.throws(() => postgresUrl({ ...config(), CATALOG_POSTGRES_TARGET: 'aiven', AIVEN_DB_PASSWORD: 'fixture' }), /development/);
    assert.throws(() => postgresUrl({ ...config(), NODE_ENV: 'production' }), /development or test/);
    const cloud = new URL(postgresUrl({ NODE_ENV: 'development', CATALOG_POSTGRES_TARGET: 'aiven', AIVEN_DB_PASSWORD: 'fixture' }));
    assert.equal(cloud.username, 'wavehouse_app'); assert.equal(cloud.pathname, '/wavehouse_dev');
});
test('Prisma verifies identity, sanitizes failures and closes failed connections', async () => {
    const runtime = createPrismaRuntime(config()); let closed = 0;
    runtime.client.$disconnect = async () => { closed++; };
    runtime.client.$connect = async () => { throw Error('private connection URL'); };
    await assert.rejects(runtime.connect(), e => e.message === 'PostgreSQL connection or role isolation verification failed' && !e.cause);
    assert.equal(closed, 1);
    runtime.client.$queryRaw = async () => { throw Error('private details'); };
    assert.equal(await runtime.ready(), false);
    runtime.client.$connect = async () => {};
    runtime.client.$queryRaw = async () => [{ database: 'wavehouse_dev', role: 'wavehouse_dev' }];
    await assert.rejects(runtime.connect(), /isolation verification failed/);
    await runtime.close(); assert.equal(closed, 3);
});
test('Aiven rejects wrong identity, TLS and elevated roles using read-only identity probes', async () => {
    for (const patch of [{ database: 'postgres' }, { role: 'avnadmin' }, { session: 'avnadmin' }, { tls: false }, { elevated: true }]) {
        const runtime = createPrismaRuntime({ NODE_ENV: 'development', CATALOG_POSTGRES_TARGET: 'aiven', AIVEN_DB_PASSWORD: 'fixture', AIVEN_CA_PATH: '../ca.pem' });
        runtime.client.$connect = async () => {};
        runtime.client.$disconnect = async () => {};
        runtime.client.$queryRaw = async () => [{ database: 'wavehouse_dev', role: 'wavehouse_app', session: 'wavehouse_app', tls: true, elevated: false, ...patch }];
        await assert.rejects(runtime.connect(), /isolation verification failed/);
    }
});
test('compiled server boots and closes when MongoDB modules cannot load', () => {
    const script = `
        const assert=require('node:assert/strict'), Module=require('node:module'), net=require('node:net');
        const load=Module._load;
        Module._load=function(name,...args){if(/^(mongoose|mongodb)(\\/|$)/.test(name))throw Error('MongoDB runtime import');return load.call(this,name,...args);};
        const db=require('./dist/db/prisma'); let connected=0,closed=0;
        db.createPrismaRuntime=()=>({client:{},connect:async()=>{connected++},ready:async()=>true,close:async()=>{closed++}});
        (async()=>{const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));process.env.PORT=String(probe.address().port);await new Promise(r=>probe.close(r));
        const server=await require('./dist/server').startServer();
        const response=await fetch('http://127.0.0.1:'+server.address().port+'/health');assert.equal(response.status,200);assert.equal(connected,1);
        const shutdown=process.listeners('SIGTERM').at(-1);shutdown();shutdown();
        for(let i=0;i<100&&closed===0;i++)await new Promise(r=>setTimeout(r,10));assert.equal(closed,1);console.log('mongo-free lifecycle passed');})().catch(()=>{process.exitCode=1});
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_ENV: 'test', CATALOG_POSTGRES_TARGET: 'local', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres' } });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /mongo-free lifecycle passed/);
});
test('startup releases Prisma after connect, app and listener failures without leaking driver details', async t => {
    const db = require('../dist/db/prisma'), apps = require('../dist/app'), net = require('node:net');
    const { startServer } = require('../dist/server');
    t.mock.method(require('../dist/config/postgres'), 'loadPostgresEnvironment', () => {});
    const before = { ...process.env };
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before); });
    Object.assign(process.env, { NODE_ENV: 'test', CATALOG_POSTGRES_TARGET: 'local' });
    for (const failure of ['connect', 'app', 'listener']) {
        const blocker = net.createServer(); await new Promise(r => blocker.listen(0, '127.0.0.1', r));
        process.env.PORT = String(blocker.address().port);
        if (failure !== 'listener') await new Promise(r => blocker.close(r));
        let closed = 0;
        const factory = t.mock.method(db, 'createPrismaRuntime', () => ({ client: {}, connect: async () => { if (failure === 'connect') throw Error('private URL'); }, ready: async () => true, close: async () => { closed++; } }));
        const original = apps.createApp;
        const appMock = t.mock.method(apps, 'createApp', (...args) => { if (failure === 'app') throw Error('private URL'); return original(...args); });
        try { await assert.rejects(startServer(), e => e.message === 'Backend database connection or startup failed' && !e.cause); assert.equal(closed, 1); }
        finally { if (blocker.listening) await new Promise(r => blocker.close(r)); factory.mock.restore(); appMock.mock.restore(); }
    }
});

test('environment loading is deterministic, quiet and disabled for isolated tests', t => {
    const env = process.env.NODE_ENV;
    t.after(() => { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; });
    const calls = [];
    t.mock.method(require('dotenv'), 'config', options => { calls.push(options); return {}; });
    const { loadPostgresEnvironment } = require('../dist/config/postgres');
    process.env.NODE_ENV = 'test'; loadPostgresEnvironment(); assert.equal(calls.length, 0);
    process.env.NODE_ENV = 'development'; loadPostgresEnvironment();
    assert.deepEqual(calls.map(value => require('node:path').basename(value.path)), ['.env.local', '.env', '.env.postgres']);
    for (const options of calls) { assert.equal(options.quiet, true); assert.equal(options.override, false); }
});

test('shutdown attempts Prisma cleanup after socket failures and sanitizes every failure', async t => {
    for (const failure of ['postgres close', 'socket close', 'async socket close']) await t.test(failure, async t => {
        const db = require('../dist/db/prisma'), apps = require('../dist/app'), net = require('node:net');
        const beforePort = process.env.PORT, beforeExit = process.exitCode;
        t.after(() => { if (beforePort === undefined) delete process.env.PORT; else process.env.PORT = beforePort; process.exitCode = beforeExit; });
        const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
        process.env.PORT = String(probe.address().port); await new Promise(r => probe.close(r));
        t.mock.method(require('../dist/config/postgres'), 'loadPostgresEnvironment', () => {});
        let closed = 0, application, actualClose;
        const errors = [];
        t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', message => errors.push(message));
        t.mock.method(db, 'createPrismaRuntime', () => ({ client: {}, connect: async () => {}, ready: async () => true, close: async () => {
            closed++; if (failure === 'postgres close') throw Error('private details');
        } }));
        const create = apps.createApp;
        t.mock.method(apps, 'createApp', (...args) => {
            application = create(...args); actualClose = application.io.close.bind(application.io);
            if (failure !== 'postgres close') application.io.close = () => {
                if (failure === 'socket close') throw Error('private details');
                return Promise.reject(Error('private details'));
            };
            return application;
        });
        const before = process.listeners('SIGTERM');
        try {
            await require('../dist/server').startServer();
            const shutdown = process.listeners('SIGTERM').at(-1);
            shutdown(); shutdown();
            for (let i = 0; i < 100 && process.listeners('SIGTERM').includes(shutdown); i++) await new Promise(r => setTimeout(r, 10));
            assert.equal(closed, 1); assert.deepEqual(errors, ['Shutdown failed']); assert.equal(process.exitCode, 1);
            assert.deepEqual(process.listeners('SIGTERM'), before);
        } finally { if (application?.server.listening) await new Promise(r => actualClose(r)); }
    });
});
