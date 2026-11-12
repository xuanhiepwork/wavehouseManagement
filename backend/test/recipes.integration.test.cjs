const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { Recipe } = require('../dist/models/Recipe');
const { Product } = require('../dist/models/Product');
const { Ingredient } = require('../dist/models/Ingredient');
const { createApp } = require('../dist/app');

// No dotenv, MONGO_URI, default connection string, database/collection drops,
// or server configuration changes. The operator supplies an isolated test DB.
const uri = process.env.MONGODB_TEST_URI?.trim();
test('Recipe MongoDB integration: index enforcement, history, concurrency and replica-set activation', {
    skip: !uri ? 'MONGODB_TEST_URI is not configured' : false,
    timeout: 120000,
}, async t => {
    const prefix = `RECIPE_TEST_${randomUUID().replaceAll('-', '').toUpperCase()}`;
    const productId = new mongoose.Types.ObjectId();
    const missingProductId = new mongoose.Types.ObjectId();
    const ingredientId = new mongoose.Types.ObjectId();
    const missingIngredientId = new mongoose.Types.ObjectId();
    const ownedProductIds = [productId, missingProductId];
    let connected = false;
    let io;
    try {
        await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
        connected = true;
        // Provision explicitly in test setup, never from an API request. This is
        // additive; it does not remove or modify unrelated indexes.
        await Recipe.createIndexes();
        const metadata = await Recipe.collection.indexes();
        assert.ok(metadata.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ productId: 1, size: 1, version: 1 }) && !index.partialFilterExpression));
        assert.ok(metadata.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ productId: 1, size: 1 })
            && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ isActive: true })));
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        const transactions = !!hello.setName || hello.msg === 'isdbgrid';
        await new Product({ _id: productId, code: `${prefix}_PRODUCT`, name: 'Test product', category: prefix,
            prices: [{ size: 'M', price: 1 }], isAvailable: false }).save();
        await new Ingredient({ _id: ingredientId, code: `${prefix}_INGREDIENT`, name: 'Test ingredient', category: prefix,
            unit: 'g', costPrice: 1, isActive: false }).save();
        const app = createApp(); io = app.io;
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.address().port}/api/recipes`;
        const request = async (path = '', method = 'GET', body) => {
            const response = await fetch(`${base}${path}`, { method,
                ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(20000),
            });
            return { status: response.status, body: await response.json() };
        };
        const input = () => ({ productId: productId.toHexString(), size: 'M',
            ingredients: [{ ingredientId: ingredientId.toHexString(), quantity: 0.5 }] });
        const records = [];
        await t.test('standalone-compatible: draft creation preserves immutable versions and raw IDs', async () => {
            for (let version = 1; version <= 2; version++) {
                const result = await request('', 'POST', { ...input(), ingredients: [{ ingredientId: ingredientId.toHexString(), quantity: version / 2 }] });
                assert.equal(result.status, 201);
                records.push(result.body.data);
                assert.equal(result.body.data.version, version);
                assert.equal(result.body.data.isActive, false);
                assert.equal(result.body.data.productId, productId.toHexString());
                assert.equal(result.body.data.ingredients[0].quantity, version / 2);
            }
            assert.equal((await Recipe.findById(records[0]._id)).ingredients[0].quantity, 0.5);
            for (const method of ['PATCH', 'DELETE']) assert.equal((await request(`/${records[0]._id}`, method, {})).status, 404);
        });
        assert.equal(records.length, 2, 'Draft creation must succeed before dependent tests');
        await t.test('standalone-compatible: missing references and unsupported sizes fail without creating recipes', async () => {
            const before = await Recipe.countDocuments({ productId });
            assert.equal((await request('', 'POST', { ...input(), productId: missingProductId.toHexString() })).status, 404);
            assert.equal((await request('', 'POST', { ...input(), ingredients: [{ ingredientId: missingIngredientId.toHexString(), quantity: 1 }] })).status, 404);
            assert.equal((await request('', 'POST', { ...input(), size: 'L' })).status, 409);
            assert.equal(await Recipe.countDocuments({ productId }), before);
        });
        await t.test('standalone-compatible: MongoDB directly enforces both unique indexes', async () => {
            const stored = await Recipe.findById(records[0]._id).lean();
            const { _id, ...copy } = stored;
            await assert.rejects(Recipe.collection.insertOne({ ...copy, _id: new mongoose.Types.ObjectId() }), error => {
                assert.equal(error.code, 11000);
                assert.deepEqual(error.keyPattern, { productId: 1, size: 1, version: 1 }); return true;
            });
            await Recipe.collection.updateOne({ _id: new mongoose.Types.ObjectId(records[0]._id) }, { $set: { isActive: true } });
            try {
                await assert.rejects(Recipe.collection.updateOne({ _id: new mongoose.Types.ObjectId(records[1]._id) }, { $set: { isActive: true } }), error => {
                    assert.equal(error.code, 11000); assert.deepEqual(error.keyPattern, { productId: 1, size: 1 }); return true;
                });
            } finally { await Recipe.collection.updateMany({ productId }, { $set: { isActive: false } }); }
        });
        await t.test('standalone-compatible: concurrent creation generates unique versions or bounded 409 conflicts', async () => {
            const results = await Promise.all(Array.from({ length: 3 }, () => request('', 'POST', input())));
            assert.ok(results.every(result => [201, 409].includes(result.status)));
            for (const result of results.filter(result => result.status === 409)) {
                assert.deepEqual(result.body, { error: 'Recipe version conflict' });
            }
            assert.ok(results.some(result => result.status === 201));
            const history = await Recipe.find({ productId }).sort({ version: 1 }).lean();
            assert.equal(new Set(history.map(recipe => recipe.version)).size, history.length);
            assert.equal(history.length, 2 + results.filter(result => result.status === 201).length);
            assert.ok(history.every(recipe => recipe.isActive === false));
            const next = await request('', 'POST', input());
            assert.equal(next.status, 201);
            assert.equal(next.body.data.version, history.at(-1).version + 1);
        });
        await t.test('standalone-compatible: filtering, deterministic history ordering and pagination', async () => {
            const filter = `?productId=${productId}&size=M&limit=2`;
            const first = await request(`${filter}&page=1`);
            const second = await request(`${filter}&page=2`);
            assert.equal(first.status, 200);
            assert.deepEqual((await request(`${filter}&page=1`)).body, first.body);
            const versions = [...first.body.data, ...second.body.data].map(recipe => recipe.version);
            assert.deepEqual(versions, [...versions].sort((a, b) => b - a));
            assert.equal(new Set(versions).size, versions.length);
            assert.equal((await request(`${filter}&isActive=true`)).body.pagination.total, 0);
            assert.equal((await request(`${filter}&isActive=false`)).body.pagination.total, first.body.pagination.total);
        });
        await t.test('standalone-compatible: repeated deactivation retains content and timestamp', async () => {
            const target = records[0];
            // Start active to exercise the actual conditional write, then repeat
            // with an inactive document to verify the no-write path as well.
            await Recipe.collection.updateOne({ _id: new mongoose.Types.ObjectId(target._id) }, { $set: { isActive: true } });
            const first = await request(`/${target._id}/deactivate`, 'POST');
            assert.equal(first.status, 200);
            assert.equal(first.body.data.isActive, false);
            assert.deepEqual(await request(`/${target._id}/deactivate`, 'POST', {}), first);
            assert.deepEqual(await request(`/${target._id}`), first);
            assert.equal(first.body.data.version, target.version);
            assert.deepEqual(first.body.data.ingredients, target.ingredients);
            assert.equal((await Recipe.findById(target._id)).isActive, false);
        });
        await t.test('standalone only: activation fails safely with no nontransactional fallback', { skip: transactions ? 'Transaction-capable deployment; standalone rejection is inapplicable' : false }, async () => {
            const result = await request(`/${records[0]._id}/activate`, 'POST');
            assert.deepEqual(result, { status: 500, body: { error: 'Internal server error' } });
            assert.equal(await Recipe.countDocuments({ productId, isActive: true }), 0);
        });
        const replicaOnly = { skip: transactions ? false : 'Replica set or supported sharded deployment required for transaction test' };
        await t.test('replica-set required: activation validates current availability, missing references and supported sizes', replicaOnly, async () => {
            const path = `/${records[0]._id}/activate`;
            assert.equal((await request(path, 'POST')).status, 409);
            await Product.collection.updateOne({ _id: productId }, { $set: { isAvailable: true } });
            assert.equal((await request(path, 'POST')).status, 409);
            await Ingredient.collection.updateOne({ _id: ingredientId }, { $set: { isActive: true } });
            await Product.collection.updateOne({ _id: productId }, { $set: { prices: [{ size: 'L', price: 1 }] } });
            assert.equal((await request(path, 'POST')).status, 409);
            await Product.collection.updateOne({ _id: productId }, { $set: { prices: [{ size: 'M', price: 1 }] } });
            const orphan = await new Recipe({ productId, size: 'M', version: 100,
                ingredients: [{ ingredientId: missingIngredientId, quantity: 1 }], isActive: false }).save();
            assert.equal((await request(`/${orphan._id}/activate`, 'POST')).status, 404);
            const missingProductRecipe = await new Recipe({ productId: missingProductId, size: 'M', version: 1,
                ingredients: [{ ingredientId, quantity: 1 }], isActive: false }).save();
            assert.equal((await request(`/${missingProductRecipe._id}/activate`, 'POST')).status, 404);
            assert.equal(await Recipe.countDocuments({ productId, isActive: true }), 0);
        });
        let switchVerified = false;
        await t.test('replica-set required: deactivate-then-activate works under the actual partial unique index', replicaOnly, async () => {
            const first = await request(`/${records[0]._id}/activate`, 'POST');
            assert.equal(first.status, 200);
            const again = await request(`/${records[0]._id}/activate`, 'POST');
            assert.deepEqual(again, first);
            const switched = await request(`/${records[1]._id}/activate`, 'POST');
            if (switched.status !== 200) {
                // A failed switch must not leave the old active recipe disabled.
                // Do not attempt another activation strategy when this fails.
                assert.equal((await Recipe.findById(records[0]._id)).isActive, true);
                assert.equal((await Recipe.findById(records[1]._id)).isActive, false);
            }
            assert.equal(switched.status, 200, 'Atomic active-version switch must work with the existing partial unique index; do not weaken the index if this fails');
            assert.equal(switched.body.data.isActive, true);
            assert.equal((await Recipe.findById(records[0]._id)).isActive, false);
            assert.equal(await Recipe.countDocuments({ productId, size: 'M', isActive: true }), 1);
            for (const original of records) {
                const stored = await Recipe.findById(original._id);
                assert.equal(stored.version, original.version);
                assert.deepEqual(JSON.parse(JSON.stringify(stored.ingredients)), original.ingredients);
            }
            switchVerified = true;
        });
        const verifiedSwitchOnly = { skip: !transactions ? replicaOnly.skip
            : !switchVerified ? 'Stopped activation scenarios: required partial unique index switch was not verified' : false };
        await t.test('replica-set required: concurrent activation never commits two active versions', verifiedSwitchOnly, async () => {
            const results = await Promise.all(records.map(recipe => request(`/${recipe._id}/activate`, 'POST')));
            assert.ok(results.every(result => [200, 409].includes(result.status)));
            assert.ok(results.some(result => result.status === 200));
            assert.equal(await Recipe.countDocuments({ productId, size: 'M', isActive: true }), 1);
        });
        await t.test('replica-set required: concurrent first activation preserves uniqueness when no version is initially active', verifiedSwitchOnly, async () => {
            for (const recipe of records) assert.equal((await request(`/${recipe._id}/deactivate`, 'POST')).status, 200);
            assert.equal(await Recipe.countDocuments({ productId, size: 'M', isActive: true }), 0);
            const results = await Promise.all(records.map(recipe => request(`/${recipe._id}/activate`, 'POST')));
            assert.ok(results.every(result => [200, 409].includes(result.status)));
            assert.ok(results.some(result => result.status === 200));
            const active = await Recipe.find({ productId, size: 'M', isActive: true }).lean();
            assert.equal(active.length, 1);
            assert.ok(records.some(recipe => recipe._id === active[0]._id.toHexString()));
        });
        await t.test('replica-set required: forced failure after deactivation rolls back the transaction', verifiedSwitchOnly, async subtest => {
            const active = await Recipe.findOne({ productId, size: 'M', isActive: true }).lean();
            assert.ok(active);
            const target = records.find(recipe => recipe._id !== active._id.toHexString());
            const realSave = Recipe.prototype.save;
            const before = await Recipe.find({ productId }).sort({ _id: 1 }).lean();
            const failure = subtest.mock.method(Recipe.prototype, 'save', async function (options) {
                if (this._id.toHexString() === target._id && options?.session) throw new Error('Injected failure after transactional deactivation');
                return realSave.call(this, options);
            });
            const result = await request(`/${target._id}/activate`, 'POST');
            assert.deepEqual(result, { status: 500, body: { error: 'Internal server error' } });
            assert.equal(failure.mock.callCount(), 1);
            const after = await Recipe.find({ productId }).sort({ _id: 1 }).lean();
            assert.deepEqual(after, before);
        });
    } finally {
        try { if (io) await new Promise(resolve => io.close(resolve)); }
        finally {
            try {
                if (connected) {
                    // Preallocated, test-owned Product IDs also identify writes
                    // whose HTTP responses failed before Recipe IDs were returned.
                    await Recipe.deleteMany({ productId: { $in: ownedProductIds } });
                    await Product.deleteMany({ _id: productId });
                    await Ingredient.deleteMany({ _id: ingredientId });
                }
            } finally { await mongoose.disconnect(); }
        }
    }
});
