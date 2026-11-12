const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('../dist/generated/prisma/client');
const validation = require('../dist/validation/product.postgres.validation');
const { serializeProduct } = require('../dist/serialization/product');
const { createPostgresProductService } = require('../dist/services/product.postgres.service');
const { createApp } = require('../dist/app');
const input = () => ({ code: ' latte ', name: ' Latte ', category: ' Coffee ', prices: [{ size: 'M', price: '0.1000' }] });
const row = () => ({ id: randomUUID(), code: 'LATTE', name: 'Latte', category: 'Coffee', description: null, imageUrl: '',
    isAvailable: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    variants: ['L', 'S', 'M'].map(size => ({ id: randomUUID(), productId: randomUUID(), size, price: new Prisma.Decimal('12345678901234.1234'), activeRecipeId: randomUUID() })) });

test('PostgreSQL Product validation normalizes optional text and exact prices without coercion or rounding', () => {
    assert.deepEqual(validation.validateBody({ ...input(), description: ' ', imageUrl: ' image ', isAvailable: false }), {
        code: 'LATTE', name: 'Latte', category: 'Coffee', description: '', imageUrl: 'image', isAvailable: false, prices: [{ size: 'M', price: '0.1' }],
    });
    assert.deepEqual(validation.validateBody({ prices: [{ size: 'S', price: 0.5 }] }, true), { prices: [{ size: 'S', price: '0.5' }] });
    const invalid = [undefined, null, [], {}, 1, true, { ...input(), prices: new Array(1) }, { ...input(), prices: [] },
        { ...input(), prices: [{ size: 'M', price: '1' }, { size: 'M', price: '2' }] }, { ...input(), isAvailable: 'false' }];
    for (const key of ['_id', 'id', '__v', 'variants', 'activeRecipeId', 'createdAt', 'updatedAt', 'extra', '$set', 'prices.0.price']) invalid.push({ ...input(), [key]: 1 });
    for (const key of ['code', 'name', 'category', 'prices']) { const value = input(); delete value[key]; invalid.push(value); }
    for (const [key, max] of [['code', 64], ['name', 200], ['category', 100]]) {
        invalid.push({ ...input(), [key]: 'x'.repeat(max + 1) }, { ...input(), [key]: ' ' });
    }
    for (const key of ['description', 'imageUrl']) for (const value of [null, 1, {}, [], '\0']) invalid.push({ ...input(), [key]: value });
    for (const price of ['0.00001', '1.00000', '100000000000000', '-1', '1e2', '', ' ', null, true, NaN, Infinity, -0, -1, 0.1 + 0.2, 99999999999999.12]) invalid.push({ ...input(), prices: [{ size: 'M', price }] });
    for (const entry of [null, {}, [], { size: 'XL', price: 1 }, { size: ' M ', price: 1 }, { size: 'M', price: 1, _id: randomUUID() }]) invalid.push({ ...input(), prices: [entry] });
    for (const value of invalid) assert.throws(() => validation.validateBody(value), e => e.status === 400);
    assert.throws(() => validation.validateBody({}, true));
});

test('PostgreSQL Product queries retain both availability states, strict filters and UUID validation', () => {
    assert.equal(validation.validateQuery({}).isAvailable, undefined);
    assert.deepEqual(validation.validateQuery({ page: '2', limit: '2', category: ' Coffee ', search: ' %_\\.* ', isAvailable: 'false' }),
        { page: 2, limit: 2, category: 'Coffee', search: '%_\\.*', isAvailable: false });
    const id = randomUUID(); assert.equal(validation.validateId(id.toUpperCase()), id);
    for (const query of [{ page: '01' }, { page: '2147483648', limit: '2' }, { limit: '101' }, { search: '' }, { category: '\0' },
        { sortBy: 'name' }, { isActive: 'true' }, { isAvailable: 'True' }, { page: ['1', '2'] }]) assert.throws(() => validation.validateQuery(query));
    assert.throws(() => validation.validateId('0123456789abcdef01234567'));
    assert.equal(require('../dist/validation/product.validation').validateId('0123456789abcdef01234567'), '0123456789abcdef01234567');
});

test('PostgreSQL Product serialization preserves omission and empty text, hides internals and sorts S/M/L', () => {
    const record = row(); const dto = serializeProduct({ ...record, __v: 9 });
    assert.equal(dto._id, record.id); assert.equal(Object.hasOwn(dto, 'description'), false); assert.equal(dto.imageUrl, '');
    assert.deepEqual(dto.prices, ['S', 'M', 'L'].map(size => ({ size, price: '12345678901234.1234' })));
    assert.equal(dto.createdAt, '2026-01-01T00:00:00.000Z');
    for (const key of ['id', '__v', 'variants', 'activeRecipeId']) assert.equal(Object.hasOwn(dto, key), false);
    assert.equal(record.variants[0].size, 'L', 'Serialization must not mutate the database result');
});

test('PostgreSQL Product error mapping is constraint-specific and retries only confirmed transaction aborts', async () => {
    let calls = 0, failure;
    const db = { $transaction: async () => { calls++; throw failure; } };
    const service = createPostgresProductService(db);
    const known = (code, meta = {}) => new Prisma.PrismaClientKnownRequestError('private-password SQL adapter details', { code, meta, clientVersion: '7.10.1' });
    for (const meta of [{ modelName: 'Product', target: ['code'] }, { modelName: 'Product', driverAdapterError: { cause: {
        originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'products_code_key' } } } }]) {
        calls = 0; failure = known('P2002', meta);
        await assert.rejects(service.createProduct({}), e => e.status === 409 && e.message === 'Product code already exists'); assert.equal(calls, 1);
    }
    for (const error of [known('P2002', { modelName: 'ProductVariant', target: ['product_id', 'size'] }), known('P2002', { modelName: 'Product', target: ['id'] }),
        known('P2002', { target: ['code'] }), known('P2028'), new Error('private-password'), { code: 'P2034' }]) {
        calls = 0; failure = error;
        await assert.rejects(service.updateProduct(randomUUID(), {}), e => e.message === 'Product database operation failed' && !e.cause); assert.equal(calls, 1);
    }
    for (const error of [known('P2034'), known('P2010', { code: '40P01' }), known('P2010', { code: '40001' })]) {
        calls = 0; failure = error;
        await assert.rejects(service.updateProduct(randomUUID(), {}), e => e.status === 409 && e.message === 'Product update conflict'); assert.equal(calls, 3);
    }
    calls = 0; failure = known('P2034');
    db.$transaction = async () => { if (++calls < 3) throw failure; return 'committed'; };
    assert.equal(await service.updateProduct(randomUUID(), {}), 'committed'); assert.equal(calls, 3);
});

test('PostgreSQL Product HTTP input guards, response contracts and error redaction', async t => {
    const before = { NODE_ENV: process.env.NODE_ENV, CATALOG_INGREDIENT_STORE: process.env.CATALOG_INGREDIENT_STORE, CATALOG_PRODUCT_STORE: process.env.CATALOG_PRODUCT_STORE };
    t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    Object.assign(process.env, { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'mongodb', CATALOG_PRODUCT_STORE: 'postgres' });
    let failure; const calls = []; const record = serializeProduct(row()); const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const service = { createProduct: async data => { calls.push(data); if (failure) throw failure; return record; },
        listProducts: async () => ({ data: [record], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
        getProduct: async () => record, updateProduct: async () => record, deleteProduct: async () => ({ ...record, isAvailable: false }) };
    const { server, io } = createApp(() => true, { postgresProducts: service });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const res = await fetch(base + '/api/products' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: res.status, body: await res.json() };
    };
    try {
        assert.deepEqual(await request('', 'POST', input()), { status: 201, body: { data: record } });
        assert.equal(calls[0].prices[0].price, '0.1');
        assert.equal((await request('', 'POST', { ...input(), prices: [{ size: 'M', price: '1.00001' }] })).status, 400); assert.equal(calls.length, 1);
        for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await request('/bad', method, method === 'PATCH' ? { name: 'X' } : undefined)).status, 400);
        assert.equal((await request()).body.pagination.total, 1);
        assert.equal((await request('/' + record._id)).body.data._id, record._id);
        assert.equal((await request('/' + record._id, 'PATCH', { name: 'X' })).status, 200);
        assert.equal((await request('/' + record._id, 'DELETE')).body.data.isAvailable, false);
        const docs = await (await fetch(base + '/api-docs.json')).json();
        assert.equal(docs.components.schemas.Product.properties._id.format, 'uuid'); assert.equal(docs.components.schemas.Product.properties.__v, undefined);
        assert.equal(docs.components.schemas.ProductPrice.properties.price.type, 'string');
        assert.equal(docs.components.schemas.PostgresProductPriceInput.properties.price.oneOf.length, 2);
        assert.equal(docs.components.schemas.Ingredient.properties.__v.type, 'integer');
        failure = new Error('postgresql://private-password@host/database');
        assert.deepEqual(await request('', 'POST', input()), { status: 500, body: { error: 'Internal server error' } });
        assert.doesNotMatch(JSON.stringify(logs), /private-password|postgresql|adapter/);
    } finally { await new Promise(resolve => io.close(resolve)); }
});
