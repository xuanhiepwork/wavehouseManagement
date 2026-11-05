import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { CatalogApiError, createCatalogClient } from '../src/api/catalog.ts';
import type { IngredientQuery, ProductQuery, RecipeQuery } from '../src/api/catalog.types.ts';
import { ingredient, ingredientId, otherId, pagination, product, productId, recipe, recipeId } from './fixtures/catalog.ts';

const baseUrl = 'http://127.0.0.1:5000/api';
const initialEnvironment = process.env.EXPO_PUBLIC_API_BASE_URL;
let forbiddenFetchCalls = 0;

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  forbiddenFetchCalls = 0;
  mock.method(globalThis, 'fetch', async () => {
    forbiddenFetchCalls++;
    throw new Error('Unmocked network requests are forbidden');
  });
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  if (initialEnvironment === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = initialEnvironment;
  assert.equal(forbiddenFetchCalls, 0, 'The API tests must never reach unmocked fetch');
});

function json(value: unknown, status = 200, contentType = 'application/json; charset=utf-8') {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': contentType } });
}
function setup(value: unknown = { data: ingredient }, status = 200) {
  const fetch = mock.fn(async (..._args: Parameters<typeof globalThis.fetch>) => json(value, status));
  return { client: createCatalogClient({ baseUrl, fetch }), fetch };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function failure(request: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(request, error => {
    assert.ok(error instanceof CatalogApiError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    assert.equal('cause' in error, false);
    return true;
  });
}

describe('mobile Catalog API configuration', () => {
  const invalidBases = [undefined, '', '/api', 'not a URL', 'ftp://localhost/api', 'postgresql://localhost/db',
    'https://production.example/api', 'http://localhost.evil/api', 'http://192.168.1.2:5000/api',
    'http://10.0.2.2:5000/api', 'http://user:password@localhost/api', 'http://localhost/api?secret=x',
    'http://localhost/api#secret', 'http://localhost/elsewhere', 'http://localhost/api/recipes'];
  for (const [index, value] of invalidBases.entries()) {
    it(`rejects missing or unsafe base URL case ${index} without HTTP`, () => {
      const fetch = mock.fn<typeof globalThis.fetch>();
      assert.throws(() => createCatalogClient({ baseUrl: value, fetch }), error => {
        assert.ok(error instanceof CatalogApiError);
        assert.equal(error.code, 'CONFIGURATION');
        assert.ok(error.message.includes('EXPO_PUBLIC_API_BASE_URL'));
        assert.ok(!error.message.includes('password'));
        return true;
      });
      assert.equal(fetch.mock.calls.length, 0);
    });
  }
  for (const value of ['http://localhost:5000', 'http://127.0.0.1:5000/', 'http://127.0.0.1:5000/api/', 'http://[::1]:5000/api', 'https://localhost:5000/api']) {
    it(`normalizes the explicit loopback base ${value}`, async () => {
      const fetch = mock.fn<typeof globalThis.fetch>(async () => json({ data: ingredient }));
      await createCatalogClient({ baseUrl: value, fetch }).ingredients.detail(ingredientId);
      assert.equal(fetch.mock.calls[0].arguments[0], `${new URL(value).origin}/api/ingredients/${ingredientId}`);
    });
  }
  it('reads the named Expo public environment value without an implicit default', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:5001/api';
    const fetch = mock.fn<typeof globalThis.fetch>(async () => json({ data: product }));
    await createCatalogClient({ fetch }).products.detail(productId);
    assert.equal(fetch.mock.calls[0].arguments[0], `http://localhost:5001/api/products/${productId}`);
  });
  it('prefers an explicit base URL over the environment', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://production.example/api';
    const fetch = mock.fn<typeof globalThis.fetch>(async () => json({ data: product }));
    await createCatalogClient({ baseUrl, fetch }).products.detail(productId);
    assert.equal(fetch.mock.calls[0].arguments[0], `${baseUrl}/products/${productId}`);
  });
  for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 2_147_483_648]) {
    it(`rejects invalid timeout ${String(timeoutMs)}`, () => {
      const fetch = mock.fn<typeof globalThis.fetch>();
      assert.throws(() => createCatalogClient({ baseUrl, fetch, timeoutMs }), { code: 'CONFIGURATION' });
      assert.equal(fetch.mock.calls.length, 0);
    });
  }
});

describe('the six mobile read endpoints', () => {
  const resources = [
    ['ingredients', ingredient, ingredientId], ['products', product, productId], ['recipes', recipe, recipeId],
  ] as const;
  for (const [resource, record, id] of resources) {
    it(`${resource}.list sends GET, no body and no invented default query`, async () => {
      const expected = { data: [record], pagination };
      const { client, fetch } = setup(expected);
      assert.deepEqual(await client[resource].list(), expected);
      assert.equal(fetch.mock.calls.length, 1);
      const [url, init] = fetch.mock.calls[0].arguments;
      assert.equal(url, `${baseUrl}/${resource}`);
      assert.equal(init?.method, 'GET');
      assert.deepEqual(init?.headers, { Accept: 'application/json' });
      assert.equal(init?.body, undefined);
      assert.equal(init?.credentials, undefined);
      assert.equal(init?.redirect, undefined);
      assert.ok(init?.signal instanceof AbortSignal);
    });
    it(`${resource}.detail sends the exact UUID path and preserves the data envelope`, async () => {
      const expected = { data: record };
      const { client, fetch } = setup(expected);
      assert.deepEqual(await client[resource].detail(id), expected);
      assert.equal(fetch.mock.calls.length, 1);
      const [url, init] = fetch.mock.calls[0].arguments;
      assert.equal(url, `${baseUrl}/${resource}/${id}`);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.deepEqual(init?.headers, { Accept: 'application/json' });
    });
    it(`${resource} exposes only list and detail, with no mutation operations`, () => {
      const { client } = setup();
      assert.deepEqual(Object.keys(client).sort(), ['ingredients', 'products', 'recipes']);
      assert.deepEqual(Object.keys(client[resource]).sort(), ['detail', 'list']);
      for (const operation of ['create', 'update', 'delete', 'softDelete', 'activate', 'deactivate']) {
        assert.equal(operation in client[resource], false);
      }
    });
    it(`${resource}.detail verifies returned UUID identity rather than accepting a different record`, async () => {
      const { client } = setup({ data: { ...record, _id: otherId } });
      await failure(client[resource].detail(id), 'MALFORMED_RESPONSE');
    });
    it(`${resource}.detail accepts a case-insensitive UUID identity while preserving raw server text`, async () => {
      const value = { ...record, _id: id.toUpperCase() };
      const { client } = setup({ data: value });
      assert.deepEqual(await client[resource].detail(id), { data: value });
    });
  }
  it('serializes Ingredient filters, reserved characters, sorting, pagination and false', async () => {
    const { client, fetch } = setup({ data: [], pagination: { page: 3, limit: 5, total: 0, totalPages: 0 } });
    await client.ingredients.list({ page: 3, limit: 5, category: ' Dairy & milk ', unit: 'g', isActive: false,
      search: ' sữa +%_?# ', sortBy: 'costPrice', sortOrder: 'desc' });
    assert.deepEqual(Object.fromEntries(new URL(String(fetch.mock.calls[0].arguments[0])).searchParams), {
      page: '3', limit: '5', category: 'Dairy & milk', unit: 'g', isActive: 'false', search: 'sữa +%_?#', sortBy: 'costPrice', sortOrder: 'desc',
    });
  });
  it('preserves false Product availability while omitting supported undefined fields', async () => {
    const { client, fetch } = setup({ data: [product], pagination });
    await client.products.list({ isAvailable: false, search: undefined, category: undefined });
    assert.deepEqual(Object.fromEntries(new URL(String(fetch.mock.calls[0].arguments[0])).searchParams), { isAvailable: 'false' });
    assert.equal((await client.products.list({ isAvailable: false })).data[0].isAvailable, false);
  });
  it('requests all Recipe history without isActive and supports a separate explicit active lookup', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async input => {
      const params = new URL(String(input)).searchParams;
      return json({ data: [recipe], pagination: { ...pagination, page: Number(params.get('page') ?? '1'), limit: Number(params.get('limit') ?? '20') } });
    });
    const client = createCatalogClient({ baseUrl, fetch });
    await client.recipes.list({ productId, size: 'L', page: 2, limit: 20 });
    await client.recipes.list({ productId, size: 'L', isActive: true });
    await client.recipes.list({ productId, size: 'L', isActive: false });
    const params = fetch.mock.calls.map(call => Object.fromEntries(new URL(String(call.arguments[0])).searchParams));
    assert.deepEqual(params, [
      { productId, size: 'L', page: '2', limit: '20' }, { productId, size: 'L', isActive: 'true' }, { productId, size: 'L', isActive: 'false' },
    ]);
  });
  it('preserves server version, nested membership and Product price ordering', async () => {
    const rows = [{ ...recipe, _id: otherId, version: 2 }, { ...recipe, version: 19 }];
    const { client } = setup({ data: rows, pagination: { ...pagination, total: 2 } });
    assert.deepEqual((await client.recipes.list()).data, rows);
    const { client: products } = setup({ data: product });
    assert.deepEqual((await products.products.detail(productId)).data.prices, product.prices);
  });
  it('retains exact maximum decimal strings and unavailable/inactive reference state', async () => {
    const { client: ingredients } = setup({ data: ingredient });
    const { client: products } = setup({ data: product });
    const { client: recipes } = setup({ data: recipe });
    assert.equal((await ingredients.ingredients.detail(ingredientId)).data.costPrice, '99999999999999.9999');
    assert.equal((await ingredients.ingredients.detail(ingredientId)).data.minStock, '999999999999.999999');
    assert.equal((await ingredients.ingredients.detail(ingredientId)).data.isActive, false);
    assert.equal((await products.products.detail(productId)).data.prices[0].price, '99999999999999.9999');
    assert.equal((await products.products.detail(productId)).data.isAvailable, false);
    assert.equal((await recipes.recipes.detail(recipeId)).data.ingredients[0].quantity, '999999999999.999999');
    assert.equal(typeof (await recipes.recipes.detail(recipeId)).data.ingredients[1].quantity, 'string');
  });
  for (const isActive of [true, false]) {
    it(`accepts valid historical Recipe reads with empty membership and isActive ${isActive}`, async () => {
      const empty = { ...recipe, isActive, ingredients: [] };
      const { client: list } = setup({ data: [empty], pagination });
      const { client: detail } = setup({ data: empty });
      assert.deepEqual((await list.recipes.list()).data, [empty]);
      assert.deepEqual((await detail.recipes.detail(recipeId)).data, empty);
    });
  }
  it('preserves pages beyond the current last page without synthesizing records', async () => {
    const expected = { data: [], pagination: { page: 9, limit: 2, total: 3, totalPages: 2 } };
    const { client } = setup(expected);
    assert.deepEqual(await client.products.list({ page: 9, limit: 2 }), expected);
  });
  it('preserves valid pagination and data when concurrent reads produce row/count drift', async () => {
    const expected = { data: [ingredient], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    const { client } = setup(expected);
    assert.deepEqual(await client.ingredients.list(), expected);
  });
  for (const fields of [{}, { description: '', imageUrl: '' }, { description: 'Fresh tea', imageUrl: 'https://example.test/tea.png' }]) {
    it(`accepts optional Product text fields ${JSON.stringify(fields)}`, async () => {
      const value = { ...product, ...fields };
      const { client } = setup({ data: value });
      assert.deepEqual((await client.products.detail(productId)).data, value);
    });
  }
});

describe('mobile request validation before HTTP', () => {
  const badPages = [0, -1, 0.5, NaN, Infinity, '1', null, [], {}, Number.MAX_SAFE_INTEGER + 1];
  for (const [index, page] of badPages.entries()) {
    it(`rejects invalid page case ${index} before fetch`, async () => {
      const { client, fetch } = setup();
      await failure(client.products.list({ page } as ProductQuery), 'BAD_REQUEST');
      assert.equal(fetch.mock.calls.length, 0);
    });
  }
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '20']) {
    it(`rejects invalid limit ${String(limit)} before fetch`, async () => {
      const { client, fetch } = setup();
      await failure(client.products.list({ limit } as ProductQuery), 'BAD_REQUEST');
      assert.equal(fetch.mock.calls.length, 0);
    });
  }
  it('rejects a valid-integer page whose calculated offset exceeds the backend integer range', async () => {
    const { client, fetch } = setup();
    await failure(client.products.list({ page: 2_147_483_648, limit: 2 }), 'BAD_REQUEST');
    assert.equal(fetch.mock.calls.length, 0);
  });
  const invalidQueries = [
    ['ingredients', { unit: 'kg' }], ['ingredients', { isActive: 'false' }], ['ingredients', { sortBy: 'version' }],
    ['ingredients', { sortOrder: 'up' }], ['ingredients', { search: '' }], ['ingredients', { category: '   ' }],
    ['ingredients', { search: 'milk\0tea' }], ['products', { isAvailable: 0 }], ['products', { category: [] }],
    ['products', { search: {} }], ['recipes', { productId: '507f1f77bcf86cd799439011' }],
    ['recipes', { productId: { _id: productId } }], ['recipes', { size: 'XL' }], ['recipes', { isActive: null }],
    ['ingredients', { activate: true }], ['products', { includeDeleted: true }], ['recipes', { version: 3 }],
    ['recipes', { orderBy: 'version' }], ['recipes', { isActive: undefined, unsupported: undefined }],
    ['recipes', JSON.parse('{"__proto__":{"method":"POST"}}')],
  ] as const;
  for (const [index, [resource, query]] of invalidQueries.entries()) {
    it(`rejects unsupported ${resource} query case ${index} before fetch`, async () => {
      const { client, fetch } = setup();
      const list = client[resource].list as (query: IngredientQuery | ProductQuery | RecipeQuery) => Promise<unknown>;
      await failure(list(query as IngredientQuery), 'BAD_REQUEST');
      assert.equal(fetch.mock.calls.length, 0);
    });
  }
  for (const resource of ['ingredients', 'products', 'recipes'] as const) {
    for (const [index, id] of ['', 'not-a-uuid', '507f1f77bcf86cd799439011', '../products', ` ${ingredientId}`, `${ingredientId} `].entries()) {
      it(`rejects invalid ${resource} detail UUID case ${index} before fetch`, async () => {
        const { client, fetch } = setup();
        await failure(client[resource].detail(id), 'BAD_REQUEST');
        assert.equal(fetch.mock.calls.length, 0);
      });
    }
  }
});

describe('mobile wire response validation', () => {
  const malformedRecords = [
    ['ingredients', { ...ingredient, _id: '507f1f77bcf86cd799439011' }],
    ['ingredients', { ...ingredient, __v: 0 }], ['ingredients', { ...ingredient, name: null }],
    ['ingredients', { ...ingredient, code: 1 }], ['ingredients', { ...ingredient, category: [] }],
    ['ingredients', { ...ingredient, unit: 'kg' }], ['ingredients', { ...ingredient, isActive: 'false' }],
    ['ingredients', { ...ingredient, costPrice: 0.1 }], ['ingredients', { ...ingredient, minStock: null }],
    ['products', { ...product, prices: null }], ['products', { ...product, prices: [] }],
    ['products', { ...product, prices: [{ size: 'XL', price: '1' }] }],
    ['products', { ...product, prices: [{ size: 'S', price: 1 }] }],
    ['products', { ...product, prices: [product.prices[0], product.prices[0]] }],
    ['products', { ...product, description: null }], ['products', { ...product, imageUrl: {} }],
    ['products', { ...product, isAvailable: 0 }], ['products', { ...product, __v: 0 }],
    ['recipes', { ...recipe, productId: { _id: productId } }], ['recipes', { ...recipe, size: 'XL' }],
    ['recipes', { ...recipe, version: 0 }], ['recipes', { ...recipe, version: -1 }],
    ['recipes', { ...recipe, version: 1.5 }], ['recipes', { ...recipe, version: Number.MAX_SAFE_INTEGER + 1 }],
    ['recipes', { ...recipe, isActive: 'false' }], ['recipes', { ...recipe, ingredients: null }],
    ['recipes', { ...recipe, ingredients: {} }], ['recipes', { ...recipe, ingredients: [null] }],
    ['recipes', { ...recipe, ingredients: [{ ingredientId: { _id: ingredientId }, quantity: '1' }] }],
    ['recipes', { ...recipe, ingredients: [{ ingredientId, quantity: '0' }] }],
    ['recipes', { ...recipe, ingredients: [{ ingredientId, quantity: 1 }] }],
    ['recipes', { ...recipe, ingredients: [recipe.ingredients[0], recipe.ingredients[0]] }],
    ['recipes', { ...recipe, ingredients: [recipe.ingredients[1], { ingredientId: ingredientId.toUpperCase(), quantity: '1' }] }],
    ['recipes', { ...recipe, __v: 0 }],
  ] as const;
  for (const [index, [resource, record]] of malformedRecords.entries()) {
    it(`rejects malformed ${resource} record case ${index} on both read shapes`, async () => {
      const { client: detail } = setup({ data: record });
      const { client: list } = setup({ data: [record], pagination });
      const id = resource === 'ingredients' ? ingredientId : resource === 'products' ? productId : recipeId;
      await failure(detail[resource].detail(id), 'MALFORMED_RESPONSE');
      await failure(list[resource].list(), 'MALFORMED_RESPONSE');
    });
  }
  for (const value of ['yesterday', '2026-02-30T00:00:00.000Z', '2026-11-05', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00.000+00:00', null]) {
    it(`rejects invalid timestamp ${String(value)}`, async () => {
      const { client } = setup({ data: { ...ingredient, createdAt: value } });
      await failure(client.ingredients.detail(ingredientId), 'MALFORMED_RESPONSE');
    });
  }
  for (const value of ['01', '1.00', '1e3', '-1', '+1', 'NaN', 'Infinity', '.1', '1.', '0.00001', '100000000000000']) {
    it(`rejects noncanonical or out-of-range NUMERIC(18,4) ${value}`, async () => {
      const { client } = setup({ data: { ...ingredient, costPrice: value } });
      await failure(client.ingredients.detail(ingredientId), 'MALFORMED_RESPONSE');
    });
  }
  for (const value of ['01', '1.000000', '0.0000001', '1000000000000', '1e2', '-1', '0']) {
    it(`rejects nonpositive, noncanonical or out-of-range Recipe quantity ${value}`, async () => {
      const { client } = setup({ data: { ...recipe, ingredients: [{ ingredientId, quantity: value }] } });
      await failure(client.recipes.detail(recipeId), 'MALFORMED_RESPONSE');
    });
  }
  const malformedPages = [null, {}, { data: null }, { data: ingredient }, { data: [] }, { data: [], pagination: [] },
    { data: [], pagination: { ...pagination, page: 0 } }, { data: [], pagination: { ...pagination, page: 1.5 } },
    { data: [], pagination: { ...pagination, limit: 0 } }, { data: [], pagination: { ...pagination, limit: 101 } },
    { data: [], pagination: { ...pagination, total: -1 } }, { data: [], pagination: { ...pagination, total: '1' } },
    { data: [], pagination: { ...pagination, totalPages: 3 } }, { data: [], pagination: { ...pagination, total: Number.MAX_SAFE_INTEGER + 1 } },
    { data: [ingredient, ingredient], pagination: { page: 1, limit: 1, total: 2, totalPages: 2 } }];
  for (const [index, value] of malformedPages.entries()) {
    it(`rejects malformed list envelope case ${index}`, async () => {
      const { client } = setup(value);
      await failure(client.ingredients.list(), 'MALFORMED_RESPONSE');
    });
  }
  const mismatchedPaging = [
    { query: undefined, returned: { page: 2, limit: 20 } },
    { query: { page: 2, limit: 20 }, returned: { page: 1, limit: 20 } },
    { query: undefined, returned: { page: 1, limit: 21 } },
    { query: { limit: 5 }, returned: { page: 1, limit: 20 } },
  ];
  for (const [index, { query, returned }] of mismatchedPaging.entries()) {
    it(`rejects a response for the wrong requested/default pagination context case ${index}`, async () => {
      const { client } = setup({ data: [ingredient], pagination: { ...pagination, ...returned } });
      await failure(client.ingredients.list(query), 'MALFORMED_RESPONSE');
    });
  }
  for (const [resource, record] of [['ingredients', ingredient], ['products', product], ['recipes', recipe]] as const) {
    for (const variant of ['exact', 'case-variant']) {
      it(`rejects duplicate ${resource} UUIDs in a list (${variant})`, async () => {
        const second = { ...record, _id: variant === 'exact' ? record._id : record._id.toUpperCase() };
        const { client } = setup({ data: [record, second], pagination: { ...pagination, total: 2 } });
        await failure(client[resource].list(), 'MALFORMED_RESPONSE');
      });
    }
  }
  for (const mismatch of [{ productId: otherId }, { size: 'S' }]) {
    it(`rejects Recipe records outside the requested immutable context ${JSON.stringify(mismatch)}`, async () => {
      const { client } = setup({ data: [{ ...recipe, ...mismatch }], pagination });
      await failure(client.recipes.list({ productId, size: 'L' }), 'MALFORMED_RESPONSE');
    });
  }
  for (const [index, value] of [null, {}, { data: null }, { data: [] }, ingredient].entries()) {
    it(`rejects malformed detail envelope case ${index}`, async () => {
      const { client } = setup(value);
      await failure(client.ingredients.detail(ingredientId), 'MALFORMED_RESPONSE');
    });
  }
  for (const [label, body, contentType] of [['invalid JSON', '{', 'application/json'], ['HTML', '<html>private detail</html>', 'text/html'], ['missing content type', '{}', '']] as const) {
    it(`sanitizes ${label} successful responses`, async () => {
      const fetch = mock.fn<typeof globalThis.fetch>(async () => new Response(body, { headers: { 'Content-Type': contentType } }));
      const client = createCatalogClient({ baseUrl, fetch });
      await failure(client.ingredients.detail(ingredientId), 'MALFORMED_RESPONSE', 200);
    });
  }
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'Application/JSON; charset=UTF-8']) {
    it(`accepts JSON content type ${contentType}`, async () => {
      const fetch = mock.fn<typeof globalThis.fetch>(async () => json({ data: ingredient }, 200, contentType));
      assert.deepEqual(await createCatalogClient({ baseUrl, fetch }).ingredients.detail(ingredientId), { data: ingredient });
    });
  }
  for (const [label, properties] of [['redirect flag', { redirected: true }], ['foreign origin', { url: 'https://example.test/api/ingredients' }],
    ['wrong path', { url: `${baseUrl}/products/${productId}` }], ['unexpected query', { url: `${baseUrl}/ingredients/${ingredientId}?secret=x` }]] as const) {
    it(`rejects a successful response with ${label}`, async () => {
      const response = json({ data: ingredient });
      for (const [key, value] of Object.entries(properties)) Object.defineProperty(response, key, { value });
      const fetch = mock.fn<typeof globalThis.fetch>(async () => response);
      await failure(createCatalogClient({ baseUrl, fetch }).ingredients.detail(ingredientId), 'MALFORMED_RESPONSE');
      assert.equal(fetch.mock.calls.length, 1);
    });
  }
  for (const shape of ['null', 'undefined', 'throwing-ok', 'throwing-status']) {
    it(`sanitizes a malformed fetch response with ${shape}`, async () => {
      const response: unknown = shape === 'null' ? null : shape === 'undefined' ? undefined : json({ data: ingredient });
      if (shape === 'throwing-ok' || shape === 'throwing-status') {
        Object.defineProperty(response, shape === 'throwing-ok' ? 'ok' : 'status', {
          get() { throw new Error('private response implementation detail'); },
        });
      }
      const fetch = mock.fn<typeof globalThis.fetch>(async () => response as Response);
      await assert.rejects(createCatalogClient({ baseUrl, fetch }).ingredients.detail(ingredientId), error => {
        assert.ok(error instanceof CatalogApiError);
        assert.equal(error.code, 'MALFORMED_RESPONSE');
        assert.equal(error.status, undefined);
        assert.ok(!error.message.includes('private response'));
        assert.equal('cause' in error, false);
        return true;
      });
      assert.equal(fetch.mock.calls.length, 1);
    });
  }
});

describe('safe mobile HTTP errors, cancellation and read deadlines', () => {
  for (const [status, code] of [[400, 'BAD_REQUEST'], [404, 'NOT_FOUND'], [409, 'CONFLICT'], [500, 'SERVER_ERROR'], [503, 'SERVER_ERROR'], [401, 'HTTP_ERROR']] as const) {
    it(`maps HTTP ${status} without reading or exposing a server error body`, async () => {
      const response = json({ error: 'password=private SQL trace' }, status);
      const read = mock.method(response, 'json', async () => { throw new Error('Error bodies must not be read'); });
      const readText = mock.method(response, 'text', async () => { throw new Error('Error bodies must not be read'); });
      const { client, fetch } = setup();
      fetch.mock.mockImplementation(async () => response);
      await assert.rejects(client.ingredients.detail(ingredientId), error => {
        assert.ok(error instanceof CatalogApiError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        assert.ok(!error.message.includes('private'));
        assert.equal('cause' in error, false);
        return true;
      });
      assert.equal(read.mock.calls.length, 0);
      assert.equal(readText.mock.calls.length, 0);
      assert.equal(fetch.mock.calls.length, 1);
    });
  }
  it('sanitizes a transport failure and performs no automatic retry', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async () => { throw new Error('private token and host details'); });
    const client = createCatalogClient({ baseUrl, fetch });
    await assert.rejects(client.recipes.detail(recipeId), error => {
      assert.ok(error instanceof CatalogApiError);
      assert.equal(error.code, 'NETWORK');
      assert.ok(!String(error).includes('private token'));
      return true;
    });
    assert.equal(fetch.mock.calls.length, 1);
  });
  it('repeats a failed read only when the caller explicitly requests another GET', async () => {
    let attempts = 0;
    const fetch = mock.fn<typeof globalThis.fetch>(async () => ++attempts === 1 ? json({ error: 'Unavailable' }, 503) : json({ data: recipe }));
    const client = createCatalogClient({ baseUrl, fetch });
    await failure(client.recipes.detail(recipeId), 'SERVER_ERROR', 503);
    assert.equal(fetch.mock.calls.length, 1);
    assert.deepEqual(await client.recipes.detail(recipeId), { data: recipe });
    assert.equal(fetch.mock.calls.length, 2);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET'));
  });
  it('times out an unresponsive fetch with one attempt and aborts its request signal', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    const fetch = mock.fn(async (..._args: Parameters<typeof globalThis.fetch>) => pending.promise);
    const client = createCatalogClient({ baseUrl, fetch, timeoutMs: 20 });
    const result = failure(client.ingredients.detail(ingredientId), 'TIMEOUT');
    await Promise.resolve();
    mock.timers.tick(21);
    await result;
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    pending.resolve(json({ data: ingredient }));
  });
  it('keeps the timeout active while parsing a delayed JSON response body', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const body = deferred<unknown>(), parsing = deferred<void>();
    const response = json({ data: ingredient });
    mock.method(response, 'json', async () => { parsing.resolve(); return body.promise; });
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response);
    const client = createCatalogClient({ baseUrl, fetch, timeoutMs: 20 });
    const result = failure(client.ingredients.detail(ingredientId), 'TIMEOUT');
    await parsing.promise;
    mock.timers.tick(21);
    await result;
    assert.equal(fetch.mock.calls.length, 1);
    body.resolve({ data: ingredient });
  });
  it('cancels a pre-aborted caller signal before invoking fetch', async () => {
    const controller = new AbortController();
    controller.abort('private cancellation reason');
    const { client, fetch } = setup();
    await failure(client.products.list({}, { signal: controller.signal }), 'CANCELLED');
    assert.equal(fetch.mock.calls.length, 0);
  });
  it('cancels a pending GET safely even when the fetch mock ignores abort', async () => {
    const controller = new AbortController(), pending = deferred<Response>();
    const fetch = mock.fn(async (..._args: Parameters<typeof globalThis.fetch>) => pending.promise);
    const client = createCatalogClient({ baseUrl, fetch });
    const result = failure(client.recipes.detail(recipeId, { signal: controller.signal }), 'CANCELLED');
    await Promise.resolve();
    controller.abort(new Error('private cancellation reason'));
    await result;
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    pending.resolve(json({ data: recipe }));
  });
  it('cancels while JSON parsing is pending rather than allowing late data to succeed', async () => {
    const controller = new AbortController(), body = deferred<unknown>(), parsing = deferred<void>();
    const response = json({ data: ingredient });
    mock.method(response, 'json', async () => { parsing.resolve(); return body.promise; });
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response);
    const client = createCatalogClient({ baseUrl, fetch });
    const result = failure(client.ingredients.detail(ingredientId, { signal: controller.signal }), 'CANCELLED');
    await parsing.promise;
    controller.abort();
    await result;
    body.resolve({ data: ingredient });
    assert.equal(fetch.mock.calls.length, 1);
  });
});
