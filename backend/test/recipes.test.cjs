const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Recipe } = require('../dist/models/Recipe');
const { Product } = require('../dist/models/Product');
const { Ingredient } = require('../dist/models/Ingredient');
const { createApp } = require('../dist/app');
const service = require('../dist/services/recipe.service');
const { validateBody, validateQuery } = require('../dist/validation/recipe.validation');
const { ingredientPaths, ingredientSchemas } = require('../dist/config/ingredient.openapi');
const { productPaths, productSchemas } = require('../dist/config/product.openapi');
const id = '0123456789abcdef01234567';
const productId = 'abcdefabcdefabcdefabcdef';
const ingredientId = '123456abcdef123456abcdef';
const otherId = '111111111111111111111111';
const input = () => ({ productId, size: 'M', ingredients: [{ ingredientId, quantity: 0.5 }] });
const indexes = () => [
    { key: { productId: 1, size: 1, version: 1 }, unique: true },
    { key: { productId: 1, size: 1 }, unique: true, partialFilterExpression: { isActive: true } },
];
const versionDuplicate = () => new mongoose.mongo.MongoServerError({ message: 'private', code: 11000,
    keyPattern: { productId: 1, size: 1, version: 1 }, keyValue: { productId, size: 'M', version: 1 } });
const activeDuplicate = () => new mongoose.mongo.MongoServerError({ message: 'private', code: 11000,
    keyPattern: { productId: 1, size: 1 }, keyValue: { productId, size: 'M' } });
function query(result) {
    return { select() { return this; }, session() { return this; }, lean() { return this; }, sort() { return this; },
        skip() { return this; }, limit() { return this; }, async exec() { return typeof result === 'function' ? result() : result; } };
}
function setup(t, { product = { prices: [{ size: 'M', price: 1 }], isAvailable: true },
    ingredients = [{ _id: ingredientId, isActive: true }], metadata = indexes() } = {}) {
    t.mock.method(Recipe.collection, 'indexes', async () => metadata);
    t.mock.method(Product, 'findById', () => query(product));
    t.mock.method(Ingredient, 'find', () => query(ingredients));
    t.mock.method(Recipe, 'findOne', () => query(null));
    return t.mock.method(Recipe.prototype, 'save', async function () { await this.validate(); return this; });
}
async function withApi(run) {
    const { server, io } = createApp(() => true);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const response = await fetch(`${base}/api/recipes${path}`, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, body: await response.json() };
    };
    try { await run(request, base); }
    finally { await new Promise(resolve => io.close(resolve)); }
}
const invalid = { status: 400, body: { error: 'Invalid request' } };
const serverError = { status: 500, body: { error: 'Internal server error' } };
function session(t, execute = async callback => callback()) {
    const value = { withTransaction: execute, endSession: async () => {} };
    const start = t.mock.method(mongoose.connection, 'startSession', async () => value);
    const end = t.mock.method(value, 'endSession', async () => {});
    return { value, start, end };
}

test('Recipe creation generates inactive versions and permits existing unavailable draft references', async t => {
    const save = setup(t, { product: { prices: [{ size: 'M' }], isAvailable: false }, ingredients: [{ _id: ingredientId, isActive: false }] });
    for (const method of ['init', 'createIndexes', 'syncIndexes']) t.mock.method(Recipe, method, () => { throw new Error('No request index changes'); });
    await withApi(async request => {
        const result = await request('', 'POST', input());
        assert.equal(result.status, 201);
        assert.equal(result.body.data.productId, productId);
        assert.equal(result.body.data.version, 1);
        assert.equal(result.body.data.isActive, false);
        assert.deepEqual(result.body.data.ingredients, [{ ingredientId, quantity: 0.5 }]);
        t.mock.method(Recipe, 'findOne', () => query({ version: 7 }));
        assert.equal((await request('', 'POST', input())).body.data.version, 8);
        assert.equal(save.mock.callCount(), 2);
    });
});

test('Recipe creation strictly rejects malformed bodies, protected fields, duplicate IDs and invalid quantities before database calls', async t => {
    const metadata = t.mock.method(Recipe.collection, 'indexes', () => { throw new Error('Unexpected database access'); });
    const bodies = [undefined, null, [], {}, 'text', true, 1];
    for (const field of ['productId', 'size', 'ingredients']) { const data = input(); delete data[field]; bodies.push(data); }
    for (const field of ['version', 'isActive', '_id', '__v', 'createdAt', 'updatedAt', 'extra', '$set', 'ingredients.0.quantity']) bodies.push({ ...input(), [field]: 1 });
    for (const value of ['bad', '123456789012', 'z'.repeat(24), null, 1]) bodies.push({ ...input(), productId: value });
    for (const size of ['m', 'XL', '', null, 1, ['M']]) bodies.push({ ...input(), size });
    for (const ingredients of [null, [], {}, [null], [1], [[]], [{}], [{ ingredientId }], [{ quantity: 1 }],
        [{ ingredientId, quantity: 1, extra: true }], [{ ingredientId, quantity: 1, _id: id }],
        [{ ingredientId, quantity: 1 }, { ingredientId: ingredientId.toUpperCase(), quantity: 2 }]]) bodies.push({ ...input(), ingredients });
    for (const quantity of [null, '1', true, 0, -1, [], {}]) bodies.push({ ...input(), ingredients: [{ ingredientId, quantity }] });
    for (const value of ['bad', '123456789012', null, 1]) bodies.push({ ...input(), ingredients: [{ ingredientId: value, quantity: 1 }] });
    await withApi(async request => {
        for (const body of bodies) assert.deepEqual(await request('', 'POST', body), invalid);
        assert.equal(metadata.mock.callCount(), 0);
    });
    for (const quantity of [NaN, Infinity, -Infinity]) assert.throws(() => validateBody({ ...input(), ingredients: [{ ingredientId, quantity }] }));
    assert.throws(() => validateBody({ ...input(), ingredients: new Array(1) }));
    assert.equal(validateBody({ ...input(), productId: productId.toUpperCase() }).productId, productId);
});

test('Recipe creation reports missing references and unsupported sizes without saving', async t => {
    const save = setup(t);
    await withApi(async request => {
        for (const [product, ingredients, status, error] of [
            [null, [], 404, 'Product not found'], [{ prices: [{ size: 'M' }] }, [], 404, 'Ingredient not found'],
            [{ prices: [{ size: 'L' }] }, [{ _id: ingredientId }], 409, 'Product size is not supported'],
        ]) {
            t.mock.method(Product, 'findById', () => query(product));
            t.mock.method(Ingredient, 'find', () => query(ingredients));
            assert.deepEqual(await request('', 'POST', input()), { status, body: { error } });
        }
        assert.equal(save.mock.callCount(), 0);
    });
});

test('Recipe mutation guards reject missing/misconfigured indexes and never write', async t => {
    const save = setup(t);
    t.mock.method(console, 'error', () => {});
    const mutate = t.mock.method(Recipe, 'findOneAndUpdate', () => { throw new Error('Unexpected write'); });
    const tx = session(t);
    const bad = [[], indexes().slice(0, 1), indexes().slice(1)];
    for (const change of [index => { index.unique = false; }, index => { index.sparse = true; },
        index => { index.key = { size: 1, productId: 1, version: 1 }; }, index => { index.partialFilterExpression = { isActive: true }; }]) {
        const values = indexes(); change(values[0]); bad.push(values);
    }
    for (const partial of [undefined, { isActive: false }, { isActive: true, size: 'M' }, { isActive: { $eq: true } }]) {
        const values = indexes(); values[1].partialFilterExpression = partial; bad.push(values);
    }
    await withApi(async request => {
        for (const metadata of bad) {
            t.mock.method(Recipe.collection, 'indexes', async () => metadata);
            assert.deepEqual(await request('', 'POST', input()), serverError);
            assert.deepEqual(await request(`/${id}/activate`, 'POST'), serverError);
            assert.deepEqual(await request(`/${id}/deactivate`, 'POST'), serverError);
        }
        assert.equal(save.mock.callCount(), 0);
        assert.equal(mutate.mock.callCount(), 0);
        assert.equal(tx.start.mock.callCount(), 0);
    });
});

test('Recipe version collisions reread maximum and retry at most three times; unrelated failures are not retried', async t => {
    setup(t);
    t.mock.method(console, 'error', () => {});
    let reads = 0;
    t.mock.method(Recipe, 'findOne', () => query({ version: ++reads }));
    let writes = 0;
    let failure = versionDuplicate();
    t.mock.method(Recipe.prototype, 'save', async function () {
        writes++;
        if (failure) throw failure;
        return this;
    });
    await withApi(async request => {
        assert.deepEqual(await request('', 'POST', input()), { status: 409, body: { error: 'Recipe version conflict' } });
        assert.equal(reads, 3); assert.equal(writes, 3);
        for (const [error, status] of [[activeDuplicate(), 409], [new Error('private'), 500],
            [new mongoose.mongo.MongoServerError({ message: 'private', code: 11000, keyPattern: { _id: 1 }, keyValue: { _id: id } }), 500],
            [new mongoose.mongo.MongoServerError({ message: 'private', code: 11000 }), 500]]) {
            reads = 0; writes = 0; failure = error;
            const result = await request('', 'POST', input());
            assert.equal(result.status, status);
            assert.equal(reads, 1); assert.equal(writes, 1);
        }
        let saves = 0;
        t.mock.method(Recipe.prototype, 'save', async function () { if (++saves === 1) throw versionDuplicate(); return this; });
        failure = null; reads = 0;
        const success = await request('', 'POST', input());
        assert.equal(success.status, 201);
        assert.equal(success.body.data.version, 3);
        assert.equal(saves, 2);
        t.mock.method(Recipe, 'findOne', () => query({ version: Number.MAX_SAFE_INTEGER }));
        assert.deepEqual(await request('', 'POST', input()), serverError);
    });
});

test('Recipe listing validates filters/pagination, includes history and fixes deterministic sort', async t => {
    const observed = {};
    const chain = query([new Recipe({ ...input(), version: 2, isActive: false })]);
    chain.sort = value => { observed.sort = value; return chain; };
    chain.skip = value => { observed.skip = value; return chain; };
    chain.limit = value => { observed.limit = value; return chain; };
    t.mock.method(Recipe, 'find', filter => { observed.filter = filter; return chain; });
    t.mock.method(Recipe, 'countDocuments', filter => { observed.countFilter = filter; return query(5); });
    await withApi(async request => {
        const result = await request(`?productId=${productId}&size=M&isActive=false&page=2&limit=2`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
        assert.deepEqual(observed.sort, { productId: 1, size: 1, version: -1, _id: 1 });
        assert.equal(observed.skip, 2); assert.equal(observed.limit, 2);
        assert.equal(observed.filter.productId.toHexString(), productId);
        assert.equal(observed.filter.size, 'M'); assert.equal(observed.filter.isActive, false);
        assert.deepEqual(observed.filter, observed.countFilter);
        await request(); assert.deepEqual(observed.filter, {});
        assert.equal(observed.skip, 0); assert.equal(observed.limit, 20);
        for (const value of ['page=0', 'page=01', 'page=1.5', 'page=1e2', 'limit=', 'limit=101', 'page=9007199254740991&limit=100',
            'productId=bad', 'size=m', 'isActive=True', 'isActive=1', 'size=M&size=L', 'productId[$ne]=x', 'sortBy=version', 'search=x']) {
            assert.deepEqual(await request(`?${value}`), invalid);
        }
        assert.throws(() => validateQuery({ productId: { $ne: 'x' } }));
    });
});

test('Recipe IDs, action bodies and query parameters are validated; no PATCH or DELETE exists', async t => {
    t.mock.method(Recipe, 'findById', () => query(null));
    setup(t);
    session(t);
    t.mock.method(Recipe, 'findOneAndUpdate', () => query(null));
    await withApi(async request => {
        for (const path of ['/bad', '/bad/activate', '/bad/deactivate']) {
            assert.deepEqual(await request(path, path.endsWith('bad') ? 'GET' : 'POST'), invalid);
        }
        for (const action of ['activate', 'deactivate']) {
            for (const body of [null, [], 1, { isActive: true }, { ingredients: [] }]) assert.deepEqual(await request(`/${id}/${action}`, 'POST', body), invalid);
            assert.deepEqual(await request(`/${id}/${action}?unknown=1`, 'POST'), invalid);
            assert.deepEqual(await request(`/${id}/${action}`, 'POST', {}), { status: 404, body: { error: 'Recipe not found' } });
        }
        assert.deepEqual(await request(`/${id}`), { status: 404, body: { error: 'Recipe not found' } });
        assert.deepEqual(await request(`/${id}?page=1`), invalid);
        assert.deepEqual(await request('?size=M', 'POST', input()), invalid);
        for (const method of ['PATCH', 'DELETE']) assert.deepEqual(await request(`/${id}`, method, {}), { status: 404, body: { error: 'Not found' } });
    });
});

test('Recipe activation uses one session sequentially and waits for commit before reporting success', async t => {
    setup(t);
    const doc = new Recipe({ ...input(), _id: id, version: 4, isActive: false });
    const contents = doc.ingredients.toObject();
    const events = [];
    let ready;
    const entered = new Promise(resolve => { ready = resolve; });
    let commit;
    const committed = new Promise(resolve => { commit = resolve; });
    const tx = session(t, async (callback, options) => {
        assert.equal(options.timeoutMS, 10000);
        assert.deepEqual(options.readConcern, { level: 'snapshot' });
        assert.deepEqual(options.writeConcern, { w: 'majority' });
        const result = await callback();
        events.push('commit pending'); ready(); await committed;
        events.push('commit complete'); return result;
    });
    const withSession = value => {
        const chain = query(value);
        chain.session = current => { assert.equal(current, tx.value); return chain; };
        return chain;
    };
    t.mock.method(Recipe, 'findById', () => withSession(doc));
    t.mock.method(Product, 'findById', () => withSession({ prices: [{ size: 'M' }], isAvailable: true }));
    t.mock.method(Ingredient, 'find', () => withSession([{ _id: ingredientId, isActive: true }]));
    t.mock.method(Recipe, 'updateMany', async (filter, update, options) => {
        events.push('deactivate'); assert.equal(options.session, tx.value);
        assert.equal(filter.isActive, true); assert.equal(filter._id.$ne.toString(), id);
        assert.deepEqual(update, { $set: { isActive: false } });
    });
    t.mock.method(Recipe.prototype, 'save', async function (options) {
        events.push('activate'); assert.equal(options.session, tx.value); await this.validate(); return this;
    });
    await withApi(async request => {
        let returned = false;
        const response = request(`/${id}/activate`, 'POST').then(result => { returned = true; return result; });
        await entered;
        assert.equal(returned, false);
        commit();
        const result = await response;
        assert.equal(result.status, 200); assert.equal(result.body.data.isActive, true);
        assert.equal(doc.version, 4); assert.deepEqual(doc.ingredients.toObject(), contents);
        assert.deepEqual(events, ['deactivate', 'activate', 'commit pending', 'commit complete']);
        assert.equal(tx.end.mock.callCount(), 1);
    });
});

test('Recipe activation revalidates missing/unusable references and already-active recipes without state writes', async t => {
    setup(t); session(t);
    const doc = new Recipe({ ...input(), _id: id, isActive: true });
    t.mock.method(Recipe, 'findById', () => query(doc));
    const writes = t.mock.method(Recipe, 'updateMany', () => { throw new Error('Unexpected write'); });
    const save = t.mock.method(Recipe.prototype, 'save', () => { throw new Error('Unexpected save'); });
    await withApi(async request => {
        for (const [product, ingredients, status] of [[null, [], 404],
            [{ prices: [{ size: 'M' }], isAvailable: true }, [], 404],
            [{ prices: [{ size: 'L' }], isAvailable: true }, [{ _id: ingredientId, isActive: true }], 409],
            [{ prices: [{ size: 'M' }], isAvailable: false }, [{ _id: ingredientId, isActive: true }], 409],
            [{ prices: [{ size: 'M' }], isAvailable: true }, [{ _id: ingredientId, isActive: false }], 409],
            [{ prices: [{ size: 'M' }], isAvailable: true }, [{ _id: ingredientId, isActive: true }], 200]]) {
            t.mock.method(Product, 'findById', () => query(product));
            t.mock.method(Ingredient, 'find', () => query(ingredients));
            assert.equal((await request(`/${id}/activate`, 'POST')).status, status);
        }
        assert.equal(writes.mock.callCount(), 0); assert.equal(save.mock.callCount(), 0);
    });
});

test('Recipe transaction errors are sanitized, sessions end and no fallback activation occurs', async t => {
    setup(t);
    t.mock.method(console, 'error', () => {});
    const writes = t.mock.method(Recipe, 'updateMany', () => { throw new Error('No fallback'); });
    let failure;
    const tx = session(t, async () => { throw failure; });
    await withApi(async request => {
        for (const [error, status] of [[new Error('Standalone transaction unsupported'), 500],
            [new mongoose.mongo.MongoServerError({ message: 'private uncertain commit', errorLabels: ['UnknownTransactionCommitResult'] }), 500],
            [new mongoose.mongo.MongoServerError({ message: 'private transient conflict', errorLabels: ['TransientTransactionError'] }), 409],
            [new mongoose.mongo.MongoServerError({ message: 'private uncertain conflict', code: 11000,
                keyPattern: { productId: 1, size: 1 }, keyValue: { productId, size: 'M' },
                errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'] }), 500],
            [activeDuplicate(), 409], [new Error('private transaction failure'), 500]]) {
            failure = error;
            const result = await request(`/${id}/activate`, 'POST');
            assert.equal(result.status, status);
            assert.deepEqual(Object.keys(result.body), ['error']);
            assert.doesNotMatch(result.body.error, /private|rollback|stack|Standalone/);
        }
        assert.equal(tx.end.mock.callCount(), 6); assert.equal(writes.mock.callCount(), 0);
    });
});

test('Recipe transaction callback retries are capped at three body executions', async t => {
    setup(t);
    const doc = new Recipe({ ...input(), _id: id, isActive: false });
    t.mock.method(Recipe, 'findById', () => query(doc));
    let writes = 0;
    t.mock.method(Recipe, 'updateMany', async () => { writes++; });
    session(t, async callback => {
        for (let attempt = 0; attempt < 4; attempt++) { doc.isActive = false; await callback(); }
    });
    await withApi(async request => {
        assert.deepEqual(await request(`/${id}/activate`, 'POST'), { status: 409, body: { error: 'Recipe activation conflict' } });
        assert.equal(writes, 3);
    });
});

test('Recipe deactivation is conditional/idempotent and requires no catalog availability checks', async t => {
    setup(t);
    const doc = new Recipe({ ...input(), _id: id, version: 9, isActive: true });
    const original = doc.ingredients.toObject();
    const update = t.mock.method(Recipe, 'findOneAndUpdate', (filter, change, options) => {
        assert.deepEqual(filter, { _id: id, isActive: true });
        assert.deepEqual(change, { $set: { isActive: false } });
        assert.equal(options.runValidators, true);
        if (!doc.isActive) return query(null);
        doc.isActive = false; return query(doc);
    });
    t.mock.method(Recipe, 'findById', () => query(doc));
    const product = t.mock.method(Product, 'findById', () => { throw new Error('No reference requirement'); });
    const ingredients = t.mock.method(Ingredient, 'find', () => { throw new Error('No reference requirement'); });
    await withApi(async request => {
        const result = await request(`/${id}/deactivate`, 'POST');
        assert.equal(result.status, 200); assert.equal(result.body.data.isActive, false);
        assert.deepEqual(await request(`/${id}/deactivate`, 'POST'), result);
        assert.deepEqual(await request(`/${id}`), result);
        assert.equal(doc.version, 9); assert.deepEqual(doc.ingredients.toObject(), original);
        assert.equal(product.mock.callCount(), 0); assert.equal(ingredients.mock.callCount(), 0);
        assert.equal(update.mock.callCount(), 2);
    });
});

test('Recipe malformed JSON, unexpected database errors and ambiguous duplicates use consistent safe errors', async t => {
    setup(t); t.mock.method(console, 'error', () => {});
    await withApi(async (request, base) => {
        for (const body of ['{', 'null', JSON.stringify(input()).replace('0.5', '1e400')]) {
            const response = await fetch(`${base}/api/recipes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            assert.equal(response.status, 400); assert.deepEqual(await response.json(), invalid.body);
        }
        for (const failure of [new Error('private database stack'),
            new mongoose.mongo.MongoServerError({ message: 'private', code: 11000 })]) {
            t.mock.method(Recipe, 'findById', () => query(() => { throw failure; }));
            assert.deepEqual(await request(`/${id}`), serverError);
        }
    });
});

test('Recipe Swagger documents five operations and preserves all existing catalog documentation', async () => {
    await withApi(async (_request, base) => {
        const docs = await (await fetch(`${base}/api-docs.json`)).json();
        for (const paths of [ingredientPaths, productPaths]) for (const [path, definition] of Object.entries(paths)) assert.deepEqual(docs.paths[path], definition);
        for (const schemas of [ingredientSchemas, productSchemas]) for (const [name, definition] of Object.entries(schemas)) assert.deepEqual(docs.components.schemas[name], definition);
        assert.ok(docs.paths['/api/recipes'].post); assert.ok(docs.paths['/api/recipes'].get);
        assert.ok(docs.paths['/api/recipes/{id}'].get);
        assert.ok(docs.paths['/api/recipes/{id}/activate'].post); assert.ok(docs.paths['/api/recipes/{id}/deactivate'].post);
        assert.equal(docs.paths['/api/recipes/{id}'].patch, undefined);
        assert.match(await (await fetch(`${base}/api-docs/`)).text(), /Swagger UI/);
    });
});

test('Recipe creation batches all ingredient references and detects a missing member of a larger recipe', async t => {
    const save = setup(t);
    const references = [{ ingredientId, quantity: 0.5 }, { ingredientId: otherId, quantity: 2 }];
    let available = [{ _id: ingredientId, isActive: false }, { _id: otherId, isActive: true }];
    const find = t.mock.method(Ingredient, 'find', filter => {
        assert.deepEqual(filter, { _id: { $in: [ingredientId, otherId] } });
        const chain = query(available);
        chain.session = current => { assert.equal(current, null); return chain; };
        return chain;
    });
    await withApi(async request => {
        const result = await request('', 'POST', { ...input(), ingredients: references });
        assert.equal(result.status, 201);
        assert.deepEqual(result.body.data.ingredients, references);
        assert.equal(find.mock.callCount(), 1);
        available = available.slice(0, 1);
        assert.deepEqual(await request('', 'POST', { ...input(), ingredients: references }),
            { status: 404, body: { error: 'Ingredient not found' } });
        assert.equal(find.mock.callCount(), 2);
        assert.equal(save.mock.callCount(), 1);
    });
});

test('Recipe mutations fail closed on primary index metadata errors without reference queries or writes', async t => {
    const save = setup(t);
    t.mock.method(console, 'error', () => {});
    const product = t.mock.method(Product, 'findById', () => { throw new Error('Must not reach reference lookup'); });
    const update = t.mock.method(Recipe, 'findOneAndUpdate', () => { throw new Error('Must not reach mutation'); });
    const tx = session(t);
    let failure;
    const metadata = t.mock.method(Recipe.collection, 'indexes', async options => {
        assert.equal(options.readPreference, 'primary'); throw failure;
    });
    await withApi(async request => {
        for (const error of [new mongoose.mongo.MongoServerError({ message: 'private namespace missing', code: 26 }),
            new mongoose.mongo.MongoServerError({ message: 'private metadata privilege missing', code: 13 })]) {
            failure = error;
            assert.deepEqual(await request('', 'POST', input()), serverError);
            assert.deepEqual(await request(`/${id}/activate`, 'POST'), serverError);
            assert.deepEqual(await request(`/${id}/deactivate`, 'POST'), serverError);
        }
        assert.equal(metadata.mock.callCount(), 6);
        assert.equal(product.mock.callCount(), 0);
        assert.equal(update.mock.callCount(), 0);
        assert.equal(save.mock.callCount(), 0);
        assert.equal(tx.start.mock.callCount(), 0);
    });
});

test('Recipe creation rejects corrupt historical version numbers without attempting a save', async t => {
    const save = setup(t);
    t.mock.method(console, 'error', () => {});
    let version;
    const latest = t.mock.method(Recipe, 'findOne', () => query({ version }));
    await withApi(async request => {
        for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '7', undefined]) {
            version = value;
            assert.deepEqual(await request('', 'POST', input()), serverError);
        }
        assert.equal(latest.mock.callCount(), 8);
        assert.equal(save.mock.callCount(), 0);
    });
});

test('Recipe creation never retries duplicate-shaped non-MongoDB errors or incomplete collision metadata', async t => {
    setup(t); t.mock.method(console, 'error', () => {});
    const latest = t.mock.method(Recipe, 'findOne', () => query(null));
    let failure;
    const save = t.mock.method(Recipe.prototype, 'save', async () => { throw failure; });
    await withApi(async request => {
        for (const error of [Object.assign(new Error('private'), { code: 11000,
            keyPattern: { productId: 1, size: 1, version: 1 }, keyValue: { productId, size: 'M', version: 1 } }),
            new mongoose.mongo.MongoServerError({ message: 'private', code: 11000,
                keyPattern: { productId: 1, size: 1, version: 1 }, keyValue: { productId, size: 'M' } })]) {
            failure = error;
            assert.deepEqual(await request('', 'POST', input()), serverError);
        }
        assert.equal(latest.mock.callCount(), 2);
        assert.equal(save.mock.callCount(), 2);
    });
});

test('Concurrent Recipe creation retries a simulated unique-index race and returns distinct versions', { timeout: 10000 }, async t => {
    setup(t);
    // This simulates only the unique-index contract. Real MongoDB enforcement
    // and concurrency are separately covered by the optional integration suite.
    let release;
    const bothRead = new Promise(resolve => { release = resolve; });
    let initialReads = 0;
    const saved = new Map();
    t.mock.method(Recipe, 'findOne', () => query(async () => {
        if (++initialReads <= 2) {
            if (initialReads === 2) release();
            await bothRead;
            return null;
        }
        return { version: Math.max(...saved.keys()) };
    }));
    const save = t.mock.method(Recipe.prototype, 'save', async function () {
        await this.validate();
        if (saved.has(this.version)) throw versionDuplicate();
        saved.set(this.version, this); return this;
    });
    const results = await Promise.all([service.createRecipe(validateBody(input())), service.createRecipe(validateBody(input()))]);
    assert.deepEqual(results.map(recipe => recipe.version).sort(), [1, 2]);
    assert.ok(results.every(recipe => recipe.isActive === false));
    assert.equal(save.mock.callCount(), 3);
    assert.equal(saved.size, 2);
});

test('Recipe activation failures after transactional deactivation end the session and never attempt a fallback', async t => {
    setup(t); t.mock.method(console, 'error', () => {});
    const doc = new Recipe({ ...input(), _id: id, version: 2, isActive: false });
    t.mock.method(Recipe, 'findById', () => query(doc));
    const tx = session(t);
    const staged = t.mock.method(Recipe, 'updateMany', async (_filter, _change, options) => {
        assert.equal(options.session, tx.value);
    });
    const save = t.mock.method(Recipe.prototype, 'save', async function (options) {
        assert.equal(options.session, tx.value);
        assert.equal(staged.mock.callCount(), 1);
        throw new Error('private write failed after staging deactivation');
    });
    await withApi(async request => {
        assert.deepEqual(await request(`/${id}/activate`, 'POST'), serverError);
        assert.equal(staged.mock.callCount(), 1);
        assert.equal(save.mock.callCount(), 1);
        assert.equal(tx.end.mock.callCount(), 1);
        assert.equal(doc.version, 2);
    });
    // This checks error propagation, not real rollback. Rollback is verified
    // only when the replica-set integration scenario executes.
});
