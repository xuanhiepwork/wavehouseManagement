const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('../dist/generated/prisma/client');
const validation = require('../dist/validation/ingredient.postgres.validation');
const { decimalInput } = require('../dist/validation/decimal');
const { serializeIngredient } = require('../dist/serialization/ingredient');
const { createPostgresIngredientService } = require('../dist/services/ingredient.postgres.service');
const { createApp } = require('../dist/app');
process.env.NODE_ENV = 'test';
process.env.CATALOG_INGREDIENT_STORE = 'postgres';
const input = () => ({ code: ' beans ', name: ' Coffee ', category: ' Test ', unit: 'g', costPrice: '0.1000' });
const row = () => ({ id: randomUUID(), code: 'BEANS', name: 'Coffee', category: 'Test', unit: 'g',
    costPrice: new Prisma.Decimal('99999999999999.1234'), minStock: new Prisma.Decimal('0.000001'),
    isActive: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });

test('PostgreSQL decimals normalize strings without rounding and accept bounded numbers', () => {
    for (const [value, scale, expected] of [['000.1000', 4, '0.1'], ['0', 6, '0'], ['99999999999999.9999', 4, '99999999999999.9999'],
        ['999999999999.999999', 6, '999999999999.999999'], [0.1, 4, '0.1'], [0.000001, 6, '0.000001'], [0, 4, '0']]) {
        assert.equal(decimalInput(value, scale), expected);
    }
    for (const value of [null, true, {}, [], '', ' ', '-0', '-1', '+1', '.1', '1.', '1e2', 'NaN', 'Infinity', '1.00000',
        '100000000000000', '0.00001', NaN, Infinity, -Infinity, -0, -1, 0.1 + 0.2, 9007199254740992, 99999999999999.12]) {
        assert.throws(() => decimalInput(value, 4), error => error.status === 400);
    }
    assert.throws(() => decimalInput('0.0000001', 6));
    assert.throws(() => decimalInput('1'.repeat(101), 4));
});

test('PostgreSQL body validation normalizes and checks schema lengths and protected fields', () => {
    assert.deepEqual(validation.validateBody(input()), { code: 'BEANS', name: 'Coffee', category: 'Test', unit: 'g', costPrice: '0.1' });
    assert.deepEqual(validation.validateBody({ minStock: 0, isActive: false }, true), { minStock: '0', isActive: false });
    const invalid = [null, [], {}, 'text', { ...input(), code: ' ' }, { ...input(), unit: 'kg' }, { ...input(), isActive: null },
        { ...input(), name: '\0' }, { ...input(), code: 'a'.repeat(65) }, { ...input(), code: 'ß'.repeat(33) },
        { ...input(), name: 'a'.repeat(201) }, { ...input(), category: 'a'.repeat(101) }];
    for (const key of ['_id', 'id', '__v', 'createdAt', 'updatedAt', 'currentStock', '$set', 'extra']) invalid.push({ ...input(), [key]: 1 });
    for (const key of ['code', 'name', 'category', 'unit', 'costPrice']) { const value = input(); delete value[key]; invalid.push(value); }
    for (const value of invalid) assert.throws(() => validation.validateBody(value), error => error.status === 400);
    assert.throws(() => validation.validateBody({}, true));
});

test('PostgreSQL IDs and queries retain strict validation without changing legacy ObjectId rules', () => {
    const id = randomUUID(); assert.equal(validation.validateId(id.toUpperCase()), id);
    for (const value of ['0123456789abcdef01234567', 'bad', null, 1]) assert.throws(() => validation.validateId(value));
    assert.equal(require('../dist/validation/ingredient.validation').validateId('0123456789abcdef01234567'), '0123456789abcdef01234567');
    const q = validation.validateQuery({ search: ' %_\\.* ', sortBy: 'costPrice', sortOrder: 'desc', isActive: 'false', page: '2', limit: '2' });
    assert.equal(q.search, '%_\\.*'); assert.equal(q.isActive, false); assert.equal(q.page, 2);
    assert.equal(validation.validateQuery({}).isActive, true);
    for (const q of [{ page: '01' }, { page: '2147483648', limit: '2' }, { search: '' }, { search: '\0' }, { unit: 'kg' },
        { isActive: 'True' }, { sortBy: '__proto__' }, { category: ['x', 'y'] }, { extra: '1' }]) assert.throws(() => validation.validateQuery(q));
});

test('PostgreSQL serializer exposes only approved fields and canonical exact decimal strings', () => {
    const record = row(); const dto = serializeIngredient({ ...record, secret: 'private', __v: 9 });
    assert.equal(dto._id, record.id); assert.equal(dto.costPrice, '99999999999999.1234'); assert.equal(dto.minStock, '0.000001');
    assert.equal(dto.createdAt, '2026-01-01T00:00:00.000Z');
    for (const key of ['id', '__v', 'secret', 'recipeIngredients']) assert.equal(Object.hasOwn(dto, key), false);
    assert.equal(serializeIngredient({ ...record, costPrice: new Prisma.Decimal('1000'), minStock: new Prisma.Decimal('0') }).costPrice, '1000');
});

test('PostgreSQL service uses supplied fields only, literal LIKE escaping and deterministic sorting', async () => {
    const record = row(); const seen = {};
    const db = { ingredient: {
        update: async args => { seen.update = args; return record; },
        findMany: async args => { seen.find = args; return [record]; }, count: async args => { seen.count = args; return 3; },
    } };
    const service = createPostgresIngredientService(db);
    await service.updateIngredient(record.id, { name: 'New' });
    assert.deepEqual(seen.update, { where: { id: record.id }, data: { name: 'New' } });
    const result = await service.listIngredients(validation.validateQuery({ search: '%_\\.*', sortBy: 'costPrice', sortOrder: 'desc', limit: '2', page: '2' }));
    assert.deepEqual(seen.find.orderBy, [{ costPrice: 'desc' }, { id: 'desc' }]);
    assert.equal(seen.find.skip, 2); assert.equal(seen.find.take, 2);
    assert.deepEqual(seen.find.where.OR[0], { code: { contains: '\\%\\_\\\\.*', mode: 'insensitive' } });
    assert.deepEqual(seen.count.where, seen.find.where);
    assert.deepEqual(result.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
});

test('PostgreSQL service scopes conflicts and discards raw database errors', async () => {
    let failure;
    const service = createPostgresIngredientService({ ingredient: { create: async () => { throw failure; }, findUnique: async () => null } });
    const known = (code, meta) => new Prisma.PrismaClientKnownRequestError('private-password connection string', { code, meta, clientVersion: '7.10.1' });
    failure = known('P2002', { modelName: 'Ingredient', target: ['code'] });
    await assert.rejects(service.createIngredient({}), e => e.status === 409 && e.message === 'Ingredient code already exists');
    failure = known('P2002', { modelName: 'Ingredient', driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'ingredients_code_key' } } } });
    await assert.rejects(service.createIngredient({}), e => e.status === 409);
    for (const error of [known('P2002', { modelName: 'Ingredient', target: ['id'] }), known('P2002', { target: ['code'] }),
        known('P2002', { modelName: 'Ingredient', driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'ingredients_pkey' } } } }),
        known('P2004', {}), new Error('private-password'), { code: 'P2002', meta: { modelName: 'Ingredient', target: ['code'] } }]) {
        failure = error; await assert.rejects(service.createIngredient({}), e => e.message === 'Ingredient database operation failed' && !e.cause);
    }
    await assert.rejects(service.getIngredient(randomUUID()), e => e.status === 404);
});

test('PostgreSQL HTTP validation, envelopes, documentation and error logs are sanitized', async t => {
    const calls = []; let failure;
    const record = serializeIngredient(row());
    const service = {
        createIngredient: async data => { calls.push(data); if (failure) throw failure; return record; },
        listIngredients: async () => ({ data: [record], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
        getIngredient: async () => record, updateIngredient: async () => record, deleteIngredient: async () => ({ ...record, isActive: false }),
    };
    const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
    const { server, io } = createApp(() => true, { postgresIngredients: service });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const res = await fetch(base + '/api/ingredients' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: res.status, body: await res.json() };
    };
    try {
        assert.deepEqual(await request('', 'POST', input()), { status: 201, body: { data: record } });
        assert.equal(calls[0].costPrice, '0.1');
        for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await request('/bad', method, method === 'PATCH' ? { name: 'X' } : undefined)).status, 400);
        assert.equal((await request('', 'POST', { ...input(), costPrice: '0.00001' })).status, 400);
        assert.equal(calls.length, 1);
        assert.equal((await request()).body.pagination.total, 1);
        assert.equal((await request('/' + record._id)).body.data._id, record._id);
        assert.equal((await request('/' + record._id, 'PATCH', { name: 'X' })).status, 200);
        assert.equal((await request('/' + record._id, 'DELETE')).body.data.isActive, false);
        const docs = await (await fetch(base + '/api-docs.json')).json();
        assert.equal(docs.components.schemas.Ingredient.properties._id.format, 'uuid');
        assert.equal(docs.components.schemas.Ingredient.properties.__v, undefined);
        assert.equal(docs.components.schemas.Ingredient.properties.costPrice.type, 'string');
        assert.equal(docs.components.schemas.Product.properties.prices.type, 'array');
        failure = new Error('postgresql://private-password@host/database');
        assert.deepEqual(await request('', 'POST', input()), { status: 500, body: { error: 'Internal server error' } });
        assert.doesNotMatch(JSON.stringify(logs), /private-password|postgresql|database/);
        const malformed = await fetch(base + '/api/ingredients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(malformed.status, 400);
    } finally { await new Promise(resolve => io.close(resolve)); }
});
