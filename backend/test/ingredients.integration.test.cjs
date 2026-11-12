const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { Ingredient } = require('../dist/models/Ingredient');
const { createApp } = require('../dist/app');

// Deliberately do not load dotenv or use MONGO_URI. Only an explicitly supplied
// dedicated test URI authorizes connecting. No database/collection is dropped.
const uri = process.env.MONGODB_TEST_URI?.trim();
test('Ingredient API with real MongoDB and provisioned unique index', {
    skip: !uri ? 'MONGODB_TEST_URI is not configured' : false,
    timeout: 60000,
}, async t => {
    const prefix = `ING_TEST_${randomUUID().replaceAll('-', '').toUpperCase()}`;
    const codes = ['A', 'B', 'C', 'DIRECT'].map(suffix => `${prefix}_${suffix}`);
    const ownedIds = [];
    let io;
    let connected = false;
    try {
        await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
        connected = true;
        // Explicitly build declared indexes before any duplicate-key assertions.
        // createIndexes is additive: it does not drop existing indexes.
        await Ingredient.createIndexes();
        const indexes = await Ingredient.collection.indexes();
        assert.ok(indexes.some(index => index.unique === true && index.key.code === 1 && Object.keys(index.key).length === 1));
        const app = createApp();
        io = app.io;
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}/api/ingredients`;
        const request = async (path = '', method = 'GET', body) => {
            const response = await fetch(`${base}${path}`, { method,
                ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(10000),
            });
            return { status: response.status, body: await response.json() };
        };
        const data = code => ({ code, name: ' Same name ', category: ` ${prefix} `, unit: 'g', costPrice: 1 });
        let first;
        await t.test('creation persists normalization and defaults', async () => {
            for (const code of codes.slice(0, 3)) {
                const result = await request('', 'POST', data(` ${code.toLowerCase()} `));
                assert.equal(result.status, 201);
                const doc = result.body.data;
                ownedIds.push(new mongoose.Types.ObjectId(doc._id));
                first ??= doc;
                assert.equal(doc.code, code);
                assert.equal(doc.name, 'Same name');
                assert.equal(doc.category, prefix);
                assert.equal(doc.minStock, 0);
                assert.equal(doc.isActive, true);
                assert.ok(doc.createdAt);
                assert.ok(doc.updatedAt);
                const stored = await Ingredient.findById(doc._id).lean();
                assert.equal(stored.code, code);
            }
        });
        assert.ok(first, 'Creation must succeed before dependent assertions');
        await t.test('MongoDB enforces unique codes directly and API maps POST/PATCH conflicts to 409', async () => {
            const directId = new mongoose.Types.ObjectId();
            ownedIds.push(directId);
            await assert.rejects(Ingredient.collection.insertOne({ ...data(first.code), _id: directId }), error => error.code === 11000);
            assert.deepEqual(await request('', 'POST', data(first.code.toLowerCase())),
                { status: 409, body: { error: 'Ingredient code already exists' } });
            assert.deepEqual(await request(`/${first._id}`, 'PATCH', { code: codes[1] }),
                { status: 409, body: { error: 'Ingredient code already exists' } });
            assert.equal((await Ingredient.findById(first._id)).code, first.code);
        });
        await t.test('real filtering and tied sorting yield stable, separate pages', async () => {
            const filter = `?category=${prefix}&unit=g&sortBy=name&limit=2`;
            const page1 = await request(`${filter}&page=1`);
            const page2 = await request(`${filter}&page=2`);
            assert.equal(page1.status, 200);
            assert.equal(page1.body.pagination.total, 3);
            const ids = [...page1.body.data, ...page2.body.data].map(doc => doc._id);
            assert.equal(new Set(ids).size, 3);
            assert.deepEqual(ids, [...ids].sort());
            assert.deepEqual((await request(`${filter}&page=1`)).body, page1.body);
            const search = await request(`?category=${prefix}&search=${codes[1].toLowerCase()}`);
            assert.deepEqual(search.body.data.map(doc => doc.code), [codes[1]]);
            assert.equal((await request(`?category=${prefix}&unit=ml`)).body.pagination.total, 0);
        });
        await t.test('PATCH saves normalized fields and rejects protected fields without mutating stored values', async () => {
            const result = await request(`/${first._id}`, 'PATCH', { name: ' Updated ', costPrice: 0, minStock: 0.5 });
            assert.equal(result.status, 200);
            const stored = await Ingredient.findById(first._id);
            assert.equal(stored.name, 'Updated');
            assert.equal(stored.costPrice, 0);
            assert.equal(stored.minStock, 0.5);
            assert.equal((await request(`/${first._id}`, 'PATCH', { createdAt: '2000-01-01' })).status, 400);
            assert.equal((await request(`/${first._id}`, 'PATCH', { costPrice: '5' })).status, 400);
            assert.equal((await Ingredient.findById(first._id)).costPrice, 0);
        });
        await t.test('soft deletion persists, repeats safely and retains the unique code', async () => {
            const deleted = await request(`/${first._id}`, 'DELETE');
            assert.equal(deleted.status, 200);
            assert.equal(deleted.body.data.isActive, false);
            assert.deepEqual(await request(`/${first._id}`, 'DELETE'), deleted);
            assert.equal((await request(`/${first._id}`)).body.data.isActive, false);
            assert.equal((await request(`?category=${prefix}`)).body.pagination.total, 2);
            const inactive = await request(`?category=${prefix}&isActive=false`);
            assert.deepEqual(inactive.body.data.map(doc => doc._id), [first._id]);
            assert.equal((await request('', 'POST', data(first.code))).status, 409);
            assert.equal(await Ingredient.countDocuments({ code: first.code }), 1);
        });
        await t.test('nonexistent IDs return 404 with real database lookup', async () => {
            const missing = new mongoose.Types.ObjectId().toHexString();
            for (const method of ['GET', 'PATCH', 'DELETE']) {
                assert.deepEqual(await request(`/${missing}`, method, method === 'PATCH' ? { name: 'Missing' } : undefined),
                    { status: 404, body: { error: 'Ingredient not found' } });
            }
        });
    } finally {
        try {
            if (io) await new Promise(resolve => io.close(resolve));
        } finally {
            try {
                // Exact UUID-scoped codes also cover a write whose HTTP response
                // failed before its generated ID could be collected.
                if (connected) await Ingredient.deleteMany({ $or: [{ _id: { $in: ownedIds } }, { code: { $in: codes } }] });
            } finally {
                await mongoose.disconnect();
            }
        }
    }
});
