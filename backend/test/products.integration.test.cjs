const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { Product } = require('../dist/models/Product');
const { createApp } = require('../dist/app');

// Only an explicitly supplied dedicated test URI is used. Do not load dotenv,
// read MONGO_URI, or fall back to a development/production database.
const uri = process.env.MONGODB_TEST_URI?.trim();
test('Product API with real MongoDB and verified unique-code enforcement', {
    skip: !uri ? 'MONGODB_TEST_URI is not configured' : false,
    timeout: 60000,
}, async t => {
    const prefix = `PRODUCT_TEST_${randomUUID().replaceAll('-', '').toUpperCase()}`;
    const codes = ['A', 'B', 'C'].map(suffix => `${prefix}_${suffix}`);
    const ownedIds = [];
    let connected = false;
    let io;
    try {
        await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
        connected = true;
        // Add declared indexes without dropping/rebuilding unrelated indexes.
        await Product.createIndexes();
        const indexes = await Product.collection.indexes();
        assert.ok(indexes.some(index => index.unique === true && index.key.code === 1 && Object.keys(index.key).length === 1));
        const app = createApp();
        io = app.io;
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}/api/products`;
        const request = async (path = '', method = 'GET', body) => {
            const response = await fetch(`${base}${path}`, { method,
                ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(10000),
            });
            return { status: response.status, body: await response.json() };
        };
        const data = code => ({ code, name: ' Same name ', category: ` ${prefix} `,
            description: ' Original ', imageUrl: ' original.png ', prices: [{ size: 'S', price: 0 }, { size: 'M', price: 1.5 }] });
        const products = [];
        await t.test('creation persists normalized fields, price arrays, timestamps and availability', async () => {
            // Deliberately create out of code order to verify database sorting.
            for (const code of [codes[2], codes[0], codes[1]]) {
                const result = await request('', 'POST', { ...data(` ${code.toLowerCase()} `), isAvailable: code !== codes[2] });
                assert.equal(result.status, 201);
                const doc = result.body.data;
                ownedIds.push(new mongoose.Types.ObjectId(doc._id));
                products.push(doc);
                assert.equal(doc.code, code);
                assert.equal(doc.name, 'Same name');
                assert.equal(doc.category, prefix);
                assert.equal(doc.description, 'Original');
                assert.equal(doc.imageUrl, 'original.png');
                assert.deepEqual(doc.prices, [{ size: 'S', price: 0 }, { size: 'M', price: 1.5 }]);
                assert.ok(doc.createdAt);
                assert.ok(doc.updatedAt);
                assert.equal((await Product.findById(doc._id)).code, code);
            }
        });
        assert.equal(products.length, 3, 'Creation must succeed before dependent assertions');
        const first = products.find(doc => doc.code === codes[0]);
        await t.test('unique code index rejects direct duplicates and API POST/PATCH return 409', async () => {
            const directId = new mongoose.Types.ObjectId();
            ownedIds.push(directId);
            await assert.rejects(Product.collection.insertOne({ ...data(first.code), _id: directId }), error => {
                assert.equal(error.code, 11000);
                assert.deepEqual(error.keyPattern, { code: 1 });
                return true;
            });
            assert.deepEqual(await request('', 'POST', data(first.code.toLowerCase())),
                { status: 409, body: { error: 'Product code already exists' } });
            assert.deepEqual(await request(`/${first._id}`, 'PATCH', { code: codes[1] }),
                { status: 409, body: { error: 'Product code already exists' } });
            assert.equal((await Product.findById(first._id)).code, first.code);
        });
        await t.test('default listing includes both states and uses code order across separate pages', async () => {
            const filter = `?category=${prefix}&limit=2`;
            const one = await request(`${filter}&page=1`);
            const two = await request(`${filter}&page=2`);
            assert.equal(one.status, 200);
            assert.deepEqual(one.body.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
            assert.deepEqual([...one.body.data, ...two.body.data].map(doc => doc.code), codes);
            assert.deepEqual((await request(`${filter}&page=1`)).body, one.body);
            assert.equal((await request(`${filter}&isAvailable=true`)).body.pagination.total, 2);
            assert.deepEqual((await request(`${filter}&isAvailable=false`)).body.data.map(doc => doc.code), [codes[2]]);
            assert.deepEqual((await request(`${filter}&search=${codes[1].toLowerCase()}`)).body.data.map(doc => doc.code), [codes[1]]);
            assert.equal((await request(`${filter}&search=same`)).body.pagination.total, 3);
            assert.equal((await request(`${filter}&search=.%2A`)).body.pagination.total, 0);
        });
        await t.test('PATCH fully replaces stored prices and applies optional string omission/clearing rules', async () => {
            const result = await request(`/${first._id}`, 'PATCH', { name: ' Updated ', prices: [{ size: 'L', price: 0.5 }] });
            assert.equal(result.status, 200);
            assert.equal(result.body.data.name, 'Updated');
            let stored = await Product.findById(first._id);
            assert.deepEqual(stored.prices.toObject(), [{ size: 'L', price: 0.5 }]);
            assert.equal(stored.description, 'Original');
            assert.equal(stored.imageUrl, 'original.png');
            const cleared = await request(`/${first._id}`, 'PATCH', { description: ' ', imageUrl: '' });
            assert.equal(cleared.status, 200);
            stored = await Product.findById(first._id);
            assert.equal(stored.description, '');
            assert.equal(stored.imageUrl, '');
            for (const body of [{ description: null }, { imageUrl: null }, { prices: [] }, { prices: [{ size: 'L', price: '2' }] },
                { prices: [{ size: 'L', price: 2, extra: 1 }] }, { 'prices.0.price': 2 }, { createdAt: '2000-01-01' }]) {
                assert.deepEqual(await request(`/${first._id}`, 'PATCH', body), { status: 400, body: { error: 'Invalid request' } });
            }
            assert.deepEqual((await Product.findById(first._id)).prices.toObject(), [{ size: 'L', price: 0.5 }]);
        });
        await t.test('soft deletion retains the document and reserved code; repeated deletion is idempotent', async () => {
            const deleted = await request(`/${first._id}`, 'DELETE');
            assert.equal(deleted.status, 200);
            assert.equal(deleted.body.data.isAvailable, false);
            assert.deepEqual(await request(`/${first._id}`, 'DELETE'), deleted);
            assert.deepEqual(await request(`/${first._id}`), deleted);
            assert.equal(await Product.countDocuments({ code: first.code }), 1);
            assert.equal((await request(`?category=${prefix}`)).body.pagination.total, 3);
            assert.equal((await request(`?category=${prefix}&isAvailable=false`)).body.pagination.total, 2);
            assert.equal((await request('', 'POST', data(first.code))).status, 409);
            const reactivated = await request(`/${first._id}`, 'PATCH', { isAvailable: true });
            assert.equal(reactivated.status, 200);
            assert.equal((await Product.findById(first._id)).isAvailable, true);
        });
        await t.test('valid nonexistent IDs return 404 for database-backed reads and writes', async () => {
            const missing = new mongoose.Types.ObjectId().toHexString();
            for (const method of ['GET', 'PATCH', 'DELETE']) {
                assert.deepEqual(await request(`/${missing}`, method, method === 'PATCH' ? { name: 'Missing' } : undefined),
                    { status: 404, body: { error: 'Product not found' } });
            }
        });
    } finally {
        try {
            if (io) await new Promise(resolve => io.close(resolve));
        } finally {
            try {
                // Exact UUID-scoped codes also cover writes whose HTTP responses
                // failed before their generated IDs could be recorded.
                if (connected) await Product.deleteMany({ $or: [{ _id: { $in: ownedIds } }, { code: { $in: codes } }] });
            } finally {
                await mongoose.disconnect();
            }
        }
    }
});
