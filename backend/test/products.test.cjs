const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Product } = require('../dist/models/Product');
const { createApp } = require('../dist/app');
const { validateBody, validateQuery } = require('../dist/validation/product.validation');
const { ingredientPaths, ingredientSchemas } = require('../dist/config/ingredient.openapi');

const id = '0123456789abcdef01234567';
const input = () => ({ code: ' latte ', name: ' Latte ', category: ' Coffee ', prices: [{ size: 'M', price: 12.5 }] });
const duplicate = (keyPattern = { code: 1 }, keyValue = { code: 'LATTE' }) =>
    new mongoose.mongo.MongoServerError({ message: 'private database details', code: 11000, keyPattern, keyValue });

async function withApi(run) {
    const { server, io } = createApp(() => true);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const response = await fetch(`${base}/api/products${path}`, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(5000),
        });
        return { status: response.status, body: await response.json() };
    };
    try { await run(request, base); }
    finally { await new Promise(resolve => io.close(resolve)); }
}

function fakeSave(t, callback = () => {}) {
    return t.mock.method(Product.prototype, 'save', async function () {
        await this.validate();
        callback(this);
        return this;
    });
}
const invalidResponse = { status: 400, body: { error: 'Invalid request' } };

test('Product creation uses schema normalization, defaults and optional string semantics', async t => {
    const save = fakeSave(t);
    t.mock.method(Product, 'init', () => { throw new Error('No request index initialization'); });
    t.mock.method(Product, 'createIndexes', () => { throw new Error('No request index creation'); });
    await withApi(async request => {
        const result = await request('', 'POST', input());
        assert.equal(result.status, 201);
        assert.equal(result.body.data.code, 'LATTE');
        assert.equal(result.body.data.name, 'Latte');
        assert.equal(result.body.data.category, 'Coffee');
        assert.equal(result.body.data.isAvailable, true);
        assert.equal(Object.hasOwn(result.body.data, 'description'), false);
        assert.equal(Object.hasOwn(result.body.data, 'imageUrl'), false);
        assert.deepEqual(result.body.data.prices, [{ size: 'M', price: 12.5 }]);
        const optional = await request('', 'POST', { ...input(), description: ' Fresh ', imageUrl: '  ', isAvailable: false,
            prices: [{ size: 'S', price: 0 }, { size: 'M', price: 0.5 }, { size: 'L', price: 100 }] });
        assert.equal(optional.status, 201);
        assert.equal(optional.body.data.description, 'Fresh');
        assert.equal(optional.body.data.imageUrl, '');
        assert.equal(optional.body.data.isAvailable, false);
        assert.equal(save.mock.callCount(), 2);
        assert.ok(save.mock.calls[0].this instanceof Product);
    });
});

test('Product POST/PATCH strictly reject malformed bodies, protected fields and invalid prices before persistence', async t => {
    const save = t.mock.method(Product.prototype, 'save', () => { throw new Error('Unexpected save'); });
    const find = t.mock.method(Product, 'findById', () => { throw new Error('Unexpected lookup'); });
    const invalid = [undefined, null, [], {}, 'text', 1, true];
    for (const field of ['code', 'name', 'category']) {
        for (const value of ['', ' ', null, 12, [], {}]) invalid.push({ ...input(), [field]: value });
    }
    for (const field of ['description', 'imageUrl']) {
        for (const value of [null, 1, true, [], {}]) invalid.push({ ...input(), [field]: value });
    }
    for (const value of [null, 'false', 0, 1, [], {}]) invalid.push({ ...input(), isAvailable: value });
    for (const field of ['_id', '__v', 'createdAt', 'updatedAt', 'unknown', '$set', '$push', 'prices.0.price']) {
        invalid.push({ ...input(), [field]: 'protected' });
    }
    const prices = [null, [], {}, 'M', [null], [1], [[]], [{}], [{ size: 'M' }], [{ price: 1 }],
        [{ size: 'M', price: 1 }, { size: 'M', price: 2 }]];
    for (const size of ['s', 'XL', '', ' M ', null, 1, ['M']]) prices.push([{ size, price: 1 }]);
    for (const price of ['1', '', null, true, -1, [], {}]) prices.push([{ size: 'M', price }]);
    for (const field of ['_id', '__v', 'extra', '$set', 'price.value']) prices.push([{ size: 'M', price: 1, [field]: 1 }]);
    for (const value of prices) invalid.push({ ...input(), prices: value });
    await withApi(async request => {
        for (const body of invalid) {
            assert.deepEqual(await request('', 'POST', body), invalidResponse);
            assert.deepEqual(await request(`/${id}`, 'PATCH', body), invalidResponse);
        }
        for (const field of ['code', 'name', 'category', 'prices']) {
            const body = input(); delete body[field];
            assert.deepEqual(await request('', 'POST', body), invalidResponse);
        }
        assert.equal(save.mock.callCount(), 0);
        assert.equal(find.mock.callCount(), 0);
    });
});

test('Product validation rejects nonfinite numbers before Mongoose coercion', () => {
    for (const price of [NaN, Infinity, -Infinity]) {
        for (const patch of [true, false]) assert.throws(() => validateBody({ ...input(), prices: [{ size: 'M', price }] }, patch));
    }
    assert.throws(() => validateBody({ ...input(), prices: new Array(1) }));
    assert.doesNotThrow(() => validateBody({ prices: [{ size: 'L', price: 0 }] }, true));
    assert.throws(() => validateQuery({ search: { $ne: '' } }));
});

test('Product list uses both availability states by default, matching count filters and fixed deterministic sorting', async t => {
    const observed = {};
    const docs = [new Product({ ...input(), _id: id, isAvailable: false })];
    const chain = {
        sort(value) { observed.sort = value; return this; },
        skip(value) { observed.skip = value; return this; },
        limit(value) { observed.limit = value; return this; },
        exec: async () => docs,
    };
    t.mock.method(Product, 'find', filter => { observed.filter = filter; return chain; });
    t.mock.method(Product, 'countDocuments', filter => { observed.countFilter = filter; return { exec: async () => 5 }; });
    await withApi(async request => {
        const result = await request('?page=2&limit=2&category=%20Coffee%20&isAvailable=false&search=a.%2A');
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
        assert.equal(result.body.data[0]._id, id);
        assert.deepEqual(observed.sort, { code: 1, _id: 1 });
        assert.equal(observed.skip, 2);
        assert.equal(observed.limit, 2);
        assert.deepEqual(observed.filter, { category: 'Coffee', isAvailable: false, $or: [
            { code: { $regex: 'a\\.\\*', $options: 'i' } }, { name: { $regex: 'a\\.\\*', $options: 'i' } },
        ] });
        assert.deepEqual(observed.countFilter, observed.filter);
        await request();
        assert.deepEqual(observed.filter, {});
        assert.equal(observed.skip, 0);
        assert.equal(observed.limit, 20);
        await request('?isAvailable=true');
        assert.deepEqual(observed.filter, { isAvailable: true });
    });
});

test('Product query validation rejects unknown, repeated, nested, empty and noncanonical parameters', async () => {
    await withApi(async request => {
        for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=01', 'page=9007199254740992',
            'page=9007199254740991&limit=100', 'limit=101', 'limit=0', 'limit=', 'limit=true', 'category=%20',
            'search=', 'isAvailable=', 'isAvailable=1', 'isAvailable=True', 'sortBy=name', 'sortOrder=asc',
            'isActive=true', 'page=1&page=2', 'search=a&search=b', 'category[$ne]=x', 'search[]=x', 'unknown=1']) {
            assert.deepEqual(await request(`?${query}`), invalidResponse);
        }
    });
});

test('Product IDs are validated before queries and missing documents return consistent 404', async t => {
    const find = t.mock.method(Product, 'findById', () => ({ exec: async () => null }));
    await withApi(async request => {
        for (const method of ['GET', 'PATCH', 'DELETE']) {
            for (const value of ['bad', '123456789012', 'z'.repeat(24)]) {
                assert.deepEqual(await request(`/${value}`, method, method === 'PATCH' ? { name: 'New' } : undefined), invalidResponse);
            }
        }
        assert.equal(find.mock.callCount(), 0);
        for (const method of ['GET', 'PATCH', 'DELETE']) {
            assert.deepEqual(await request(`/${id}`, method, method === 'PATCH' ? { name: 'New' } : undefined),
                { status: 404, body: { error: 'Product not found' } });
        }
    });
});

test('Product PATCH loads and saves the document, preserves omitted fields and completely replaces prices', async t => {
    const doc = new Product({ ...input(), _id: id, description: 'Original', imageUrl: 'original.png',
        prices: [{ size: 'S', price: 1 }, { size: 'M', price: 2 }] });
    const find = t.mock.method(Product, 'findById', () => ({ exec: async () => doc }));
    const save = fakeSave(t);
    await withApi(async request => {
        const result = await request(`/${id.toUpperCase()}`, 'PATCH', { code: ' tea ', name: ' Tea ', prices: [{ size: 'L', price: 0 }] });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.code, 'TEA');
        assert.equal(result.body.data.name, 'Tea');
        assert.equal(result.body.data.category, 'Coffee');
        assert.equal(result.body.data.description, 'Original');
        assert.equal(result.body.data.imageUrl, 'original.png');
        assert.deepEqual(result.body.data.prices, [{ size: 'L', price: 0 }]);
        const cleared = await request(`/${id}`, 'PATCH', { description: '  ', imageUrl: '', isAvailable: false });
        assert.equal(cleared.body.data.description, '');
        assert.equal(cleared.body.data.imageUrl, '');
        assert.equal(cleared.body.data.isAvailable, false);
        assert.deepEqual(cleared.body.data.prices, [{ size: 'L', price: 0 }]);
        const reactivated = await request(`/${id}`, 'PATCH', { description: ' Fresh ', imageUrl: ' new.png ', isAvailable: true });
        assert.equal(reactivated.body.data.description, 'Fresh');
        assert.equal(reactivated.body.data.imageUrl, 'new.png');
        assert.equal(reactivated.body.data.isAvailable, true);
        assert.equal(find.mock.callCount(), 3);
        assert.equal(save.mock.callCount(), 3);
        assert.equal(save.mock.calls[0].this, doc);
    });
});

test('Product DELETE saves only once, retains the document and permits GET while unavailable', async t => {
    const doc = new Product({ ...input(), _id: id });
    t.mock.method(Product, 'findById', () => ({ exec: async () => doc }));
    const save = fakeSave(t);
    const remove = t.mock.method(Product, 'deleteOne', () => { throw new Error('No physical deletion'); });
    await withApi(async request => {
        const result = await request(`/${id}`, 'DELETE');
        assert.equal(result.status, 200);
        assert.equal(result.body.data.isAvailable, false);
        assert.equal(result.body.data._id, id);
        assert.deepEqual(await request(`/${id}`, 'DELETE'), result);
        assert.deepEqual(await request(`/${id}`), result);
        assert.equal(save.mock.callCount(), 1);
        assert.equal(remove.mock.callCount(), 0);
    });
});

test('Only genuine MongoDB Product code duplicates map to 409 on POST/PATCH; other duplicate failures return 500', async t => {
    let failure;
    t.mock.method(Product.prototype, 'save', async () => { throw failure; });
    t.mock.method(Product, 'findById', () => ({ exec: async () => new Product({ ...input(), _id: id }) }));
    t.mock.method(console, 'error', () => {});
    await withApi(async request => {
        for (const [error, expected] of [[duplicate(), 409], [duplicate({ _id: 1 }, { _id: id }), 500],
            [duplicate({ code: 1, name: 1 }), 500], [duplicate(undefined, {}), 500],
            [new mongoose.mongo.MongoServerError({ message: 'private', code: 11000 }), 500],
            [Object.assign(new Error('private'), { code: 11000, keyPattern: { code: 1 }, keyValue: { code: 'LATTE' } }), 500]]) {
            failure = error;
            for (const [path, method, body] of [['', 'POST', input()], [`/${id}`, 'PATCH', { code: 'Other' }]]) {
                assert.deepEqual(await request(path, method, body), { status: expected,
                    body: { error: expected === 409 ? 'Product code already exists' : 'Internal server error' } });
            }
        }
    });
});

test('Product schema/cast errors return 400; unexpected read/write failures return sanitized 500', async t => {
    let failure;
    t.mock.method(Product.prototype, 'save', async () => { throw failure; });
    t.mock.method(Product, 'findById', () => ({ exec: async () => { throw failure; } }));
    t.mock.method(Product, 'find', () => { throw failure; });
    t.mock.method(console, 'error', () => {});
    await withApi(async request => {
        for (const [error, status] of [[new mongoose.Error.ValidationError(), 400],
            [new mongoose.Error.CastError('ObjectId', 'private', '_id'), 400], [new Error('private stack'), 500],
            [duplicate({ _id: 1 }, { _id: id }), 500]]) {
            failure = error;
            const expected = { status, body: { error: status === 400 ? 'Invalid request' : 'Internal server error' } };
            assert.deepEqual(await request('', 'POST', input()), expected);
            assert.deepEqual(await request(`/${id}`), expected);
            assert.deepEqual(await request(), expected);
        }
    });
});

test('Product malformed JSON and overflow numbers return 400; Swagger preserves all Ingredient paths/schemas', async () => {
    await withApi(async (_request, base) => {
        const overflow = JSON.stringify(input()).replace('12.5', '1e400');
        for (const body of ['{', '[', 'null', overflow]) {
            const response = await fetch(`${base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: 'Invalid request' });
        }
        const docs = await (await fetch(`${base}/api-docs.json`)).json();
        for (const [path, value] of Object.entries(ingredientPaths)) assert.deepEqual(docs.paths[path], value);
        for (const [name, value] of Object.entries(ingredientSchemas)) assert.deepEqual(docs.components.schemas[name], value);
        assert.ok(docs.paths['/'].get);
        assert.ok(docs.paths['/health'].get);
        assert.ok(docs.paths['/api/products'].post);
        for (const method of ['get', 'patch', 'delete']) assert.ok(docs.paths['/api/products/{id}'][method]);
        assert.equal(docs.components.schemas.ProductPrice.additionalProperties, false);
        assert.match(await (await fetch(`${base}/api-docs/`)).text(), /Swagger UI/);
    });
});
