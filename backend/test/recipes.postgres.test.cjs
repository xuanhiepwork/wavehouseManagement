const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('../dist/generated/prisma/client');
const validation = require('../dist/validation/recipe.postgres.validation');
const { serializeRecipe } = require('../dist/serialization/recipe');
const { createPostgresRecipeService, verifyRecipeFoundation } = require('../dist/services/recipe.postgres.service');
const { createApp } = require('../dist/app');
const productId = randomUUID(), ingredientId = randomUUID();
const input = () => ({ productId, size: 'M', ingredients: [{ ingredientId, quantity: '0.100000' }] });
const row = () => { const id = randomUUID(); return { id, productVariantId: randomUUID(), version: 2,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    productVariant: { productId, size: 'M', activeRecipeId: id },
    ingredients: [ingredientId, '00000000-0000-0000-0000-000000000001'].map(id => ({ id: randomUUID(), ingredientId: id, quantity: new Prisma.Decimal('0.000001') })) }; };

test('PostgreSQL Recipe quantities, UUIDs and immutable input fields are validated before writes', () => {
    assert.deepEqual(validation.validateBody(input()), { productId, size: 'M', ingredients: [{ ingredientId, quantity: '0.1' }] });
    assert.equal(validation.validateBody({ ...input(), ingredients: [{ ingredientId, quantity: 0.000001 }] }).ingredients[0].quantity, '0.000001');
    const invalid = [null, [], {}, 'text', { ...input(), ingredients: [] }, { ...input(), ingredients: new Array(1) },
        { ...input(), productId: '0123456789abcdef01234567' }, { ...input(), size: 'm' },
        { ...input(), ingredients: [{ ingredientId, quantity: 1 }, { ingredientId: ingredientId.toUpperCase(), quantity: 2 }] }];
    for (const key of ['version', 'isActive', '_id', '__v', 'productVariantId', 'createdAt', 'updatedAt', '$set', 'extra']) invalid.push({ ...input(), [key]: 1 });
    for (const key of ['productId', 'size', 'ingredients']) { const v = input(); delete v[key]; invalid.push(v); }
    for (const quantity of ['0', '0.000000', '-1', '0.0000001', '1.0000000', '1000000000000', '1e2', '', ' ', null, true, NaN, Infinity, -Infinity, -0, -1, 0.1 + 0.2, 999999999999.99]) {
        invalid.push({ ...input(), ingredients: [{ ingredientId, quantity }] });
    }
    for (const entry of [null, [], {}, { ingredientId }, { quantity: 1 }, { ingredientId, quantity: 1, _id: randomUUID() }]) invalid.push({ ...input(), ingredients: [entry] });
    for (const value of invalid) assert.throws(() => validation.validateBody(value), e => e.status === 400);
    assert.equal(validation.validateBody({ ...input(), ingredients: [{ ingredientId, quantity: '999999999999.999999' }] }).ingredients[0].quantity, '999999999999.999999');
});

test('PostgreSQL Recipe actions and list queries preserve strict legacy rules and pagination bounds', () => {
    assert.equal(validation.validateQuery({}).isActive, undefined);
    assert.deepEqual(validation.validateQuery({ productId: productId.toUpperCase(), size: 'L', isActive: 'false', page: '2', limit: '2' }),
        { page: 2, limit: 2, productId, size: 'L', isActive: false });
    for (const query of [{ page: '01' }, { page: '2147483648', limit: '2' }, { limit: '101' }, { size: 'm' }, { isActive: 'True' },
        { productId: 'bad' }, { size: ['S', 'M'] }, { search: 'x' }, { sortBy: 'version' }]) assert.throws(() => validation.validateQuery(query));
    assert.throws(() => validation.validateQuery({ page: '1' }, false));
    for (const body of [null, [], 1, { isActive: true }]) assert.throws(() => validation.validateActionBody(body));
    validation.validateActionBody(undefined); validation.validateActionBody({});
    assert.equal(require('../dist/validation/recipe.validation').validateId('0123456789abcdef01234567'), '0123456789abcdef01234567');
});

test('PostgreSQL Recipe serializer derives pointer state, hides internals and sorts Ingredient UUIDs', () => {
    const record = row(); const dto = serializeRecipe({ ...record, __v: 1, isActive: false });
    assert.equal(dto.isActive, true); assert.equal(dto._id, record.id); assert.equal(dto.productId, productId);
    assert.equal(dto.ingredients[0].ingredientId, '00000000-0000-0000-0000-000000000001');
    assert.ok(dto.ingredients.every(item => item.quantity === '0.000001' && Object.keys(item).length === 2));
    assert.equal(record.ingredients[0].ingredientId, ingredientId);
    assert.equal(serializeRecipe({ ...record, productVariant: { ...record.productVariant, activeRecipeId: randomUUID() } }).isActive, false);
    assert.equal(serializeRecipe({ ...record, ingredients: [] }).ingredients.length, 0);
    for (const key of ['id', '__v', 'productVariantId', 'productVariant', 'activeRecipeId']) assert.equal(Object.hasOwn(dto, key), false);
});

test('Recipe foundation absence fails closed without attempting writes or automatic repair', async () => {
    const queries = [];
    const tx = { $queryRaw: async sql => { queries.push(sql.join('')); return []; } };
    await assert.rejects(verifyRecipeFoundation(tx), /foundation is unavailable/);
    assert.equal(queries.length, 1); assert.match(queries[0], /SELECT/); assert.doesNotMatch(queries[0], /ALTER|CREATE|DROP|UPDATE/);
    const service = createPostgresRecipeService({ $transaction: async callback => callback(tx) });
    await assert.rejects(service.createRecipe(input()), e => e.message === 'Recipe database operation failed' && !e.cause);
});

test('Recipe retries whole transactions only for verified version collisions or definite aborts', async () => {
    let failure, calls;
    const db = { $transaction: async () => { calls++; throw failure; } };
    const service = createPostgresRecipeService(db);
    const known = (code, meta = {}) => new Prisma.PrismaClientKnownRequestError('private-password SQL adapter details', { code, meta, clientVersion: '7.10.1' });
    for (const error of [known('P2034'), known('P2010', { code: '40001' }), known('P2010', { code: '40P01' }),
        known('P2002', { modelName: 'Recipe', target: ['product_variant_id', 'version'] }),
        known('P2002', { modelName: 'Recipe', driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'recipes_product_variant_id_version_key' } } } })]) {
        failure = error; calls = 0;
        await assert.rejects(service.createRecipe(input()), e => e.status === 409 && e.message === 'Recipe version conflict'); assert.equal(calls, 3);
    }
    for (const error of [known('P2028'), known('P2002', { modelName: 'Recipe', target: ['id'] }), known('P2002', { target: ['product_variant_id', 'version'] }),
        { code: 'P2034' }, new Error('private-password uncertain commit')]) {
        failure = error; calls = 0;
        await assert.rejects(service.createRecipe(input()), e => e.message === 'Recipe database operation failed' && !e.cause); assert.equal(calls, 1);
    }
    failure = known('P2002', { modelName: 'Recipe', target: ['product_variant_id', 'version'] }); calls = 0;
    await assert.rejects(service.activateRecipe(randomUUID()), e => e.message === 'Recipe database operation failed'); assert.equal(calls, 1);
    failure = known('P2034'); calls = 0;
    await assert.rejects(service.activateRecipe(randomUUID()), e => e.status === 409 && e.message === 'Recipe activation conflict'); assert.equal(calls, 3);
    calls = 0; db.$transaction = async () => { if (++calls < 3) throw failure; return 'committed'; };
    assert.equal(await service.createRecipe(input()), 'committed'); assert.equal(calls, 3);
});

test('Recipe HTTP guards, envelopes, mode-specific docs and error logs are safe', async t => {
    const keys = ['NODE_ENV', 'CATALOG_INGREDIENT_STORE', 'CATALOG_PRODUCT_STORE', 'CATALOG_RECIPE_STORE'];
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    Object.assign(process.env, { NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres' });
    const record = serializeRecipe(row()), calls = [], logs = []; let failure;
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const service = { createRecipe: async value => { calls.push(value); if (failure) throw failure; return record; }, getRecipe: async () => record,
        listRecipes: async () => ({ data: [record], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
        activateRecipe: async () => record, deactivateRecipe: async () => ({ ...record, isActive: false }) };
    const { server, io } = createApp(() => true, { postgresIngredients: {}, postgresProducts: {}, postgresRecipes: service });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path = '', method = 'GET', body) => {
        const res = await fetch(base + '/api/recipes' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: res.status, body: await res.json() };
    };
    try {
        assert.deepEqual(await request('', 'POST', input()), { status: 201, body: { data: record } });
        assert.equal((await request('?page=1', 'POST', input())).status, 400);
        assert.equal((await request('', 'POST', { ...input(), ingredients: [] })).status, 400); assert.equal(calls.length, 1);
        assert.equal((await request('/' + record._id + '?page=1')).status, 400);
        assert.equal((await request()).body.pagination.total, 1); assert.equal((await request('/' + record._id)).status, 200);
        for (const method of ['PATCH', 'DELETE']) assert.equal((await request('/' + record._id, method, {})).status, 404);
        for (const action of ['activate', 'deactivate']) {
            assert.equal((await request('/bad/' + action, 'POST')).status, 400);
            assert.equal((await request('/' + record._id + '/' + action, 'POST', { isActive: true })).status, 400);
            assert.equal((await request('/' + record._id + '/' + action, 'POST', {})).status, 200);
        }
        const docs = await (await fetch(base + '/api-docs.json')).json();
        assert.equal(docs.components.schemas.Recipe.properties.__v, undefined);
        assert.equal(docs.components.schemas.Recipe.properties._id.format, 'uuid');
        assert.equal(docs.components.schemas.RecipeIngredient.properties.quantity.type, 'string');
        assert.equal(docs.components.schemas.PostgresRecipeIngredientInput.properties.quantity.oneOf.length, 2);
        failure = new Error('postgresql://private-password@host/database');
        assert.deepEqual(await request('', 'POST', input()), { status: 500, body: { error: 'Internal server error' } });
        assert.doesNotMatch(JSON.stringify(logs), /private-password|postgresql|SQL|adapter/);
    } finally { await new Promise(resolve => io.close(resolve)); }
});
