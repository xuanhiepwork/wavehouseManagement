const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { ingredientStore, productStore, recipeStore, catalogUsesPostgres, catalogUsesMongo, postgresUrl } = require('../dist/config/postgres');
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

test('Product opt-in is independent, validates both flags and retains all local target guards', () => {
    assert.equal(productStore({}), 'mongodb');
    for (const ingredient of ['mongodb', 'postgres']) for (const product of ['mongodb', 'postgres']) {
        const env = { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: ingredient, CATALOG_PRODUCT_STORE: product, TEST_DATABASE_URL: fixture };
        assert.equal(catalogUsesPostgres(env), ingredient === 'postgres' || product === 'postgres');
        if (ingredient === 'postgres' || product === 'postgres') assert.equal(postgresUrl(env), fixture);
    }
    for (const env of [{ CATALOG_PRODUCT_STORE: 'postgres' }, { NODE_ENV: 'production', CATALOG_PRODUCT_STORE: 'postgres' },
        { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'unknown' },
        { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'unknown', CATALOG_PRODUCT_STORE: 'postgres' }]) assert.throws(() => catalogUsesPostgres(env));
    assert.throws(() => postgresUrl({ NODE_ENV: 'test', CATALOG_PRODUCT_STORE: 'postgres', DATABASE_URL: fixture }));
});

test('Recipe selection permits exactly five configurations and rejects three mixed stores without implicit flags', () => {
    let valid = 0, invalid = 0;
    assert.equal(recipeStore({}), 'mongodb');
    for (const ingredient of ['mongodb', 'postgres']) for (const product of ['mongodb', 'postgres']) for (const recipe of ['mongodb', 'postgres']) {
        const env = { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: ingredient, CATALOG_PRODUCT_STORE: product, CATALOG_RECIPE_STORE: recipe };
        const before = { ...env };
        if (recipe === 'postgres' && (ingredient !== 'postgres' || product !== 'postgres')) { assert.throws(() => catalogUsesPostgres(env)); assert.throws(() => catalogUsesMongo(env)); invalid++; }
        else { assert.equal(recipeStore(env), recipe); catalogUsesPostgres(env); assert.equal(catalogUsesMongo(env), recipe !== 'postgres'); valid++; }
        assert.deepEqual(env, before);
    }
    assert.equal(valid, 5); assert.equal(invalid, 3);
    for (const env of [{ ...config(), CATALOG_RECIPE_STORE: 'unknown' }, { ...config(), NODE_ENV: 'production', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres' }]) assert.throws(() => catalogUsesPostgres(env));
    assert.throws(() => postgresUrl({ ...config(), CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres', TEST_DATABASE_URL: undefined, DATABASE_URL: fixture }));
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
        encoding: 'utf8', timeout: 10000, env: { ...process.env, CATALOG_INGREDIENT_STORE: 'mongodb', CATALOG_PRODUCT_STORE: 'mongodb', CATALOG_RECIPE_STORE: 'mongodb' },
    });
    assert.equal(imported.status, 0); assert.match(imported.stdout, /imports passed/);
    const rejected = spawnSync(process.execPath, ['dist/server.js'], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_ENV: 'production', CATALOG_INGREDIENT_STORE: 'postgres', DATABASE_URL: 'private-password' } });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /configuration or database unavailable/);
    assert.doesNotMatch(rejected.stderr, /private-password/);
    const productRejected = spawnSync(process.execPath, ['dist/server.js'], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_ENV: 'production', CATALOG_INGREDIENT_STORE: 'mongodb', CATALOG_PRODUCT_STORE: 'postgres', DATABASE_URL: 'private-password' } });
    assert.equal(productRejected.status, 1); assert.doesNotMatch(productRejected.stderr, /private-password/);
    const recipeRejected = spawnSync(process.execPath, ['dist/server.js'], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_ENV: 'production', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres', DATABASE_URL: 'private-password' } });
    assert.equal(recipeRejected.status, 1); assert.doesNotMatch(recipeRejected.stderr, /private-password/);
});


const selections = [
    ['mongodb', 'mongodb', 'mongodb'], ['postgres', 'mongodb', 'mongodb'],
    ['mongodb', 'postgres', 'mongodb'], ['postgres', 'postgres', 'mongodb'],
    ['postgres', 'postgres', 'postgres'],
];

async function lifecycle(t, modes, run, failure) {
    const mongoose = require('mongoose');
    const net = require('node:net');
    const runtimeModule = require('../dist/db/prisma');
    const appModule = require('../dist/app');
    const configModule = require('../dist/config/postgres');
    const { startServer } = require('../dist/server');
    const before = { ...process.env };
    const events = [];
    const postgres = modes.includes('postgres');
    const mongo = modes.includes('mongodb');
    let mongoReady = true, pgReady = true, probeThrows = false, app, originalClose;
    const oldInt = process.listeners('SIGINT'), oldTerm = process.listeners('SIGTERM');
    const oldExitCode = process.exitCode;
    const errors = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', message => errors.push(message));
    t.mock.method(configModule, 'loadPostgresEnvironment', () => {});
    const readyDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => {
        assert.ok(mongo, 'PostgreSQL-only readiness must not inspect MongoDB');
        return mongoReady ? 1 : 0;
    } });
    t.mock.method(mongoose, 'connect', async () => {
        assert.ok(mongo, 'PostgreSQL-only must not connect MongoDB');
        events.push('mongo connect');
        if (failure === 'mongo connect' || failure === 'mongo connect and close') throw Error('private driver URL');
        return mongoose;
    });
    t.mock.method(mongoose, 'disconnect', () => {
        assert.ok(mongo, 'PostgreSQL-only must not disconnect MongoDB');
        events.push('mongo close');
        if (failure === 'mongo close' || failure === 'both close' || failure === 'mongo connect and close') throw Error('private driver URL');
        return Promise.resolve();
    });
    const factory = t.mock.method(runtimeModule, 'createPrismaRuntime', () => {
        events.push('postgres allocate');
        return { client: {}, connect: async () => {
            events.push('postgres connect');
            if (failure === 'postgres connect') throw Error('private driver URL');
        }, close: async () => {
            events.push('postgres close');
            if (failure === 'postgres close' || failure === 'both close' || failure === 'mongo connect and close') throw Error('private driver URL');
        }, ready: async () => { if (probeThrows) throw Error('private driver URL'); return pgReady; } };
    });
    const create = appModule.createApp;
    t.mock.method(appModule, 'createApp', (...args) => {
        if (failure === 'application') throw Error('private application details');
        app = create(...args);
        originalClose = app.io.close.bind(app.io);
        if (failure === 'socket close' || failure === 'async socket close') {
            app.io.close = () => {
                events.push('socket close');
                if (failure === 'socket close') throw Error('private socket details');
                return Promise.reject(Error('private socket details'));
            };
        }
        return app;
    });
    const blocker = net.createServer();
    await new Promise(resolve => postgres ? blocker.listen(0, '127.0.0.1', resolve) : blocker.listen(0, resolve));
    const port = blocker.address().port;
    if (failure !== 'listener') await new Promise(resolve => blocker.close(resolve));
    Object.assign(process.env, { PORT: String(port), NODE_ENV: 'test',
        CATALOG_INGREDIENT_STORE: modes[0], CATALOG_PRODUCT_STORE: modes[1], CATALOG_RECIPE_STORE: modes[2],
        TEST_DATABASE_URL: fixture, MONGO_URI: 'not-a-valid-mongo-uri' });
    const handlers = () => ['SIGINT', 'SIGTERM'].flatMap(signal => process.listeners(signal)
        .filter(fn => !(signal === 'SIGINT' ? oldInt : oldTerm).includes(fn)));
    const settle = async () => {
        for (let i = 0; i < 200 && handlers().length; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(handlers().length, 0, 'shutdown removes both signal handlers');
    };
    try {
        await run({ startServer, events, factory, postgres, mongo, errors, port, settle,
            setHealth: (m, p, throws = false) => { mongoReady = m; pgReady = p; probeThrows = throws; } });
    } finally {
        const shutdown = handlers()[0];
        if (shutdown) { shutdown(); await settle(); }
        if (app?.server.listening && originalClose) await new Promise(resolve => originalClose(() => resolve()));
        if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
        for (const signal of ['SIGINT', 'SIGTERM']) {
            for (const fn of process.listeners(signal)) if (!(signal === 'SIGINT' ? oldInt : oldTerm).includes(fn)) process.removeListener(signal, fn);
        }
        process.exitCode = oldExitCode;
        for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
        Object.assign(process.env, before);
        if (readyDescriptor) Object.defineProperty(mongoose.connection, 'readyState', readyDescriptor);
        else delete mongoose.connection.readyState;
    }
}

test('server lifecycle and health follow all five validated dependency selections', async t => {
    for (const modes of selections) await t.test(modes.join('/'), async t => {
        await lifecycle(t, modes, async ({ startServer, events, factory, postgres, mongo, setHealth, settle }) => {
            const server = await startServer();
            assert.equal(server.listening, true);
            assert.equal(factory.mock.callCount(), postgres ? 1 : 0);
            assert.deepEqual(events, [...(postgres ? ['postgres allocate', 'postgres connect'] : []), ...(mongo ? ['mongo connect'] : [])]);
            if (postgres) assert.equal(server.address().address, '127.0.0.1');
            else assert.notEqual(server.address().address, '127.0.0.1', 'legacy retains default binding');
            const url = `http://127.0.0.1:${server.address().port}/health`;
            for (const m of [true, false]) for (const p of [true, false]) {
                setHealth(m, p);
                const response = await fetch(url);
                const healthy = (!mongo || m) && (!postgres || p);
                assert.equal(response.status, healthy ? 200 : 503);
                assert.deepEqual(await response.json(), { status: healthy ? 'ok' : 'unavailable' });
            }
            if (postgres) {
                setHealth(true, true, true);
                const response = await fetch(url);
                assert.equal(response.status, 503);
                assert.deepEqual(await response.json(), { status: 'unavailable' });
            }
            const shutdown = process.listeners('SIGTERM').at(-1);
            shutdown(); shutdown(); process.listeners('SIGINT').at(-1)();
            await settle();
            assert.equal(server.listening, false);
            assert.equal(events.filter(e => e === 'mongo close').length, mongo ? 1 : 0);
            assert.equal(events.filter(e => e === 'postgres close').length, postgres ? 1 : 0);
        });
    });
});

test('startup failures release allocated resources and never leak driver details', async t => {
    for (const [failure, modes, expected] of [
        ['application', selections[4], ['postgres allocate', 'postgres close']],
        ['postgres connect', selections[3], ['postgres allocate', 'postgres connect', 'postgres close']],
        ['mongo connect', selections[3], ['postgres allocate', 'postgres connect', 'mongo connect', 'mongo close', 'postgres close']],
        ['mongo connect and close', selections[3], ['postgres allocate', 'postgres connect', 'mongo connect', 'mongo close', 'postgres close']],
        ['listener', selections[3], ['postgres allocate', 'postgres connect', 'mongo connect', 'mongo close', 'postgres close']],
        ['listener', selections[4], ['postgres allocate', 'postgres connect', 'postgres close']],
        ['listener', selections[0], ['mongo connect', 'mongo close']],
    ]) await t.test(failure + ':' + modes.join('/'), async t => {
        await lifecycle(t, modes, async ({ startServer, events, errors }) => {
            await assert.rejects(startServer(), error => error.message === 'Backend database connection or startup failed' && !error.cause);
            assert.deepEqual(events, expected);
            assert.deepEqual(errors, []);
        }, failure);
    });
});

test('shutdown attempts every cleanup despite failures and handles either signal repeatedly', async t => {
    for (const failure of ['mongo close', 'postgres close', 'both close', 'socket close', 'async socket close']) await t.test(failure, async t => {
        await lifecycle(t, selections[3], async ({ startServer, events, errors, settle }) => {
            await startServer();
            const shutdown = process.listeners('SIGINT').at(-1);
            shutdown(); shutdown(); process.listeners('SIGTERM').at(-1)();
            await settle();
            assert.equal(events.filter(e => e === 'mongo close').length, 1);
            assert.equal(events.filter(e => e === 'postgres close').length, 1);
            assert.deepEqual(errors, ['Shutdown failed']);
            assert.equal(process.exitCode, 1);
        }, failure);
    });
});

test('invalid Recipe selections fail before application or database allocation', async t => {
    for (const modes of [['mongodb', 'mongodb', 'postgres'], ['postgres', 'mongodb', 'postgres'], ['mongodb', 'postgres', 'postgres']]) {
        await t.test(modes.join('/'), async t => lifecycle(t, modes, async ({ startServer, events, factory }) => {
            await assert.rejects(startServer(), /require explicit PostgreSQL Ingredient and Product stores/);
            assert.equal(factory.mock.callCount(), 0);
            assert.deepEqual(events, []);
        }));
    }
});
