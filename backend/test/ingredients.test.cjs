const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Ingredient } = require('../dist/models/Ingredient');
const { createApp } = require('../dist/app');
const { validateBody, validateQuery } = require('../dist/validation/ingredient.validation');

const input = () => ({ code: ' beans ', name: ' Coffee beans ', category: ' Coffee ', unit: 'g', costPrice: 12.5 });
const id = '0123456789abcdef01234567';

async function withApi(run) {
    const { server, io } = createApp(() => true);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const response = await fetch(`${base}/api/ingredients${path}`, {
            method, ...(body === undefined ? {} : {
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            }), signal: AbortSignal.timeout(5000),
        });
        return { status: response.status, body: await response.json() };
    };
    try { await run(request, base); }
    finally { await new Promise(resolve => io.close(resolve)); }
}

function fakeSave(t, onSave = () => {}) {
    t.mock.method(Ingredient.prototype, 'save', async function () {
        await this.validate();
        onSave(this);
        return this;
    });
}

test('POST normalizes through the real schema and applies defaults', async t => {
    let saved;
    fakeSave(t, doc => { saved = doc; });
    t.mock.method(Ingredient, 'init', () => { throw new Error('Request must not initialize indexes'); });
    await withApi(async request => {
        const result = await request('', 'POST', input());
        assert.equal(result.status, 201);
        assert.equal(result.body.data.code, 'BEANS');
        assert.equal(result.body.data.name, 'Coffee beans');
        assert.equal(result.body.data.category, 'Coffee');
        assert.equal(result.body.data.minStock, 0);
        assert.equal(result.body.data.isActive, true);
        assert.ok(saved instanceof Ingredient);
    });
});

test('POST rejects invalid bodies, unknown/protected fields and numeric coercion before saving', async t => {
    const save = t.mock.method(Ingredient.prototype, 'save', () => { throw new Error('Unexpected save'); });
    await withApi(async request => {
        const invalid = [null, [], {}, 'text', 1, true];
        for (const key of ['code', 'name', 'category', 'unit', 'costPrice']) {
            const body = input(); delete body[key]; invalid.push(body);
        }
        for (const key of ['_id', '__v', 'createdAt', 'updatedAt', 'currentStock', '$set', 'extra']) invalid.push({ ...input(), [key]: 1 });
        for (const field of ['costPrice', 'minStock']) {
            for (const value of ['12', '', null, true, -1, [], {}]) invalid.push({ ...input(), [field]: value });
        }
        for (const body of [
            { ...input(), code: ' ' }, { ...input(), name: 123 }, { ...input(), category: null },
            { ...input(), unit: 'kg' }, { ...input(), unit: ['g'] }, { ...input(), isActive: 'false' },
        ]) invalid.push(body);
        for (const body of invalid) {
            assert.deepEqual(await request('', 'POST', body), { status: 400, body: { error: 'Invalid request' } });
        }
        assert.equal(save.mock.callCount(), 0);
    });
    for (const field of ['costPrice', 'minStock']) {
        for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => validateBody({ ...input(), [field]: value }));
    }
    assert.doesNotThrow(() => validateBody({ ...input(), costPrice: 0, minStock: 0.25, isActive: false }));
});

test('list passes validated pagination, literal search, exact filters and deterministic sorting to MongoDB', async t => {
    const docs = [new Ingredient({ ...input(), _id: id })];
    const observed = {};
    const chain = {
        sort(value) { observed.sort = value; return this; },
        skip(value) { observed.skip = value; return this; },
        limit(value) { observed.limit = value; return this; },
        async exec() { return docs; },
    };
    t.mock.method(Ingredient, 'find', filter => { observed.filter = filter; return chain; });
    t.mock.method(Ingredient, 'countDocuments', filter => {
        observed.countFilter = filter; return { exec: async () => 5 };
    });
    await withApi(async request => {
        const result = await request('?page=2&limit=2&category=%20Coffee%20&unit=g&isActive=false&search=a.%2A&sortBy=costPrice&sortOrder=desc');
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
        assert.equal(result.body.data[0]._id, id);
        assert.deepEqual(observed.sort, { costPrice: -1, _id: -1 });
        assert.equal(observed.skip, 2);
        assert.equal(observed.limit, 2);
        assert.deepEqual(observed.filter, { isActive: false, category: 'Coffee', unit: 'g', $or: [
            { code: { $regex: 'a\\.\\*', $options: 'i' } }, { name: { $regex: 'a\\.\\*', $options: 'i' } },
        ] });
        assert.deepEqual(observed.countFilter, observed.filter);
        await request();
        assert.deepEqual(observed.filter, { isActive: true });
        assert.deepEqual(observed.sort, { name: 1, _id: 1 });
        assert.equal(observed.skip, 0);
        assert.equal(observed.limit, 20);
    });
});

test('invalid and repeated query parameters produce consistent 400 errors', async () => {
    await withApi(async request => {
        for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=01', 'page=9007199254740991&limit=100',
            'limit=101', 'limit=true', 'limit=', 'sortBy=_id', 'sortBy=__proto__', 'sortOrder=up', 'isActive=1',
            'category=%20', 'search=', 'unit=kg', 'unknown=1', 'page=1&page=2', 'category[$ne]=x']) {
            assert.deepEqual(await request(`?${query}`), { status: 400, body: { error: 'Invalid request' } });
        }
    });
    assert.throws(() => validateQuery({ category: { $ne: 'x' } }));
});

test('GET/PATCH/DELETE reject invalid IDs and return 404 for valid nonexistent IDs', async t => {
    const find = t.mock.method(Ingredient, 'findById', () => ({ exec: async () => null }));
    await withApi(async request => {
        for (const method of ['GET', 'PATCH', 'DELETE']) {
            for (const invalid of ['bad', '123456789012', 'z'.repeat(24)]) {
                assert.deepEqual(await request(`/${invalid}`, method, method === 'PATCH' ? { name: 'New' } : undefined),
                    { status: 400, body: { error: 'Invalid request' } });
            }
        }
        assert.equal(find.mock.callCount(), 0);
        for (const method of ['GET', 'PATCH', 'DELETE']) {
            assert.deepEqual(await request(`/${id}`, method, method === 'PATCH' ? { name: 'New' } : undefined),
                { status: 404, body: { error: 'Ingredient not found' } });
        }
    });
});

test('PATCH loads a document, assigns fields, saves and normalizes; rejects protected/invalid fields', async t => {
    const doc = new Ingredient({ ...input(), _id: id });
    const find = t.mock.method(Ingredient, 'findById', () => ({ exec: async () => doc }));
    let saves = 0;
    fakeSave(t, () => saves++);
    await withApi(async request => {
        const result = await request(`/${id}`, 'PATCH', { code: ' tea ', name: ' Tea ', costPrice: 0, minStock: 0.5, isActive: false });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.code, 'TEA');
        assert.equal(result.body.data.name, 'Tea');
        assert.equal(result.body.data.category, 'Coffee');
        assert.equal(result.body.data.costPrice, 0);
        assert.equal(result.body.data.isActive, false);
        assert.equal(saves, 1);
        for (const body of [{}, null, [], { name: ' ' }, { costPrice: '1' }, { minStock: -1 }, { isActive: null },
            ...['_id', '__v', 'createdAt', 'updatedAt', 'currentStock', 'unknown', '$set'].map(key => ({ [key]: 'x' }))]) {
            assert.deepEqual(await request(`/${id}`, 'PATCH', body), { status: 400, body: { error: 'Invalid request' } });
        }
        assert.equal(find.mock.callCount(), 1);
        assert.equal(saves, 1);
    });
});

test('DELETE is soft and idempotent; GET retains access to inactive records', async t => {
    const doc = new Ingredient({ ...input(), _id: id });
    t.mock.method(Ingredient, 'findById', () => ({ exec: async () => doc }));
    let saves = 0;
    fakeSave(t, () => saves++);
    await withApi(async request => {
        for (let i = 0; i < 2; i++) {
            const result = await request(`/${id}`, 'DELETE');
            assert.equal(result.status, 200);
            assert.equal(result.body.data.isActive, false);
            assert.equal(result.body.data._id, id);
        }
        assert.equal(saves, 1);
        assert.equal((await request(`/${id}`)).body.data.isActive, false);
    });
});

test('duplicate, schema, cast and unexpected errors are sanitized consistently', async t => {
    let failure;
    t.mock.method(Ingredient.prototype, 'save', async () => { throw failure; });
    t.mock.method(console, 'error', () => {});
    const validation = new mongoose.Error.ValidationError();
    await withApi(async request => {
        for (const [error, status, message] of [
            [Object.assign(new Error('secret database details'), { code: 11000 }), 409, 'Ingredient code already exists'],
            [validation, 400, 'Invalid request'],
            [new mongoose.Error.CastError('ObjectId', 'secret', '_id'), 400, 'Invalid request'],
            [new Error('secret server stack'), 500, 'Internal server error'],
        ]) {
            failure = error;
            assert.deepEqual(await request('', 'POST', input()), { status, body: { error: message } });
        }
    });
});

test('malformed JSON returns 400 and Ingredient documentation extends existing Swagger', async () => {
    await withApi(async (_request, base) => {
        for (const body of ['{', '{"costPrice":1e400}', '[', 'null']) {
            const response = await fetch(`${base}/api/ingredients`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            });
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: 'Invalid request' });
        }
        const docs = await (await fetch(`${base}/api-docs.json`)).json();
        assert.ok(docs.paths['/'].get);
        assert.ok(docs.paths['/health'].get);
        assert.ok(docs.paths['/api/ingredients'].post);
        assert.ok(docs.paths['/api/ingredients/{id}'].patch);
        assert.equal(docs.components.schemas.IngredientPatch.additionalProperties, false);
    });
});
