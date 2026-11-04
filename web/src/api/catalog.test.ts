import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { CatalogApiError, createCatalogClient } from './catalog'
import type { Ingredient, IngredientInput, Product, ProductInput, Recipe, RecipeInput } from './catalog'

const id = '12345678-1234-1234-1234-123456789abc'
const otherId = '22345678-1234-1234-1234-123456789abc'
const metadata = { _id: id, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T01:00:00.000Z' }
const ingredientInput: IngredientInput = {
  code: 'ING', name: 'Milk', category: 'Dairy', unit: 'ml',
  costPrice: '99999999999999.9999', minStock: '999999999999.999999', isActive: false,
}
const ingredient: Ingredient = { ...metadata, ...ingredientInput, minStock: ingredientInput.minStock!, isActive: false }
const productInput: ProductInput = {
  code: 'PRO', name: 'Tea', category: 'Drinks', isAvailable: false,
  prices: [{ size: 'S', price: '0' }, { size: 'M', price: '0.0001' }, { size: 'L', price: '99999999999999.9999' }],
}
const product: Product = { ...metadata, ...productInput, isAvailable: false }
const recipeInput: RecipeInput = {
  productId: otherId, size: 'L', ingredients: [
    { ingredientId: id, quantity: '0.000001' },
    { ingredientId: otherId, quantity: '999999999999.999999' },
  ],
}
const recipe: Recipe = { ...metadata, ...recipeInput, version: 2, isActive: false }
const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 }
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
function setup(value: unknown = { data: ingredient }, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(value, status))
  const client = createCatalogClient({ baseUrl: 'http://127.0.0.1:5000/api', fetch })
  return { client, fetch }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('configuration', () => {
  it.each([undefined, '', 'https://production.example/api', '/api', 'postgresql://localhost/db',
    'http://localhost.evil/api', 'http://user:password@localhost/api', 'http://localhost/api?secret=x',
    'http://localhost/api#secret', 'http://localhost/elsewhere'])('rejects unsafe or missing base URL %s', baseUrl => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(() => createCatalogClient({ baseUrl })).toThrowError(CatalogApiError)
    expect(() => createCatalogClient({ baseUrl })).toThrow('VITE_API_BASE_URL')
  })
  it.each(['http://localhost:5000', 'http://127.0.0.1:5000/', 'http://127.0.0.1:5000/api/', 'http://[::1]:5000/api'])('normalizes local base %s', async baseUrl => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ data: ingredient }))
    await createCatalogClient({ baseUrl, fetch }).ingredients.detail(id)
    expect(fetch.mock.calls[0][0]).toBe(`${new URL(baseUrl).origin}/api/ingredients/${id}`)
  })
  it('reads VITE_API_BASE_URL without needing UI integration', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:5001/api')
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ data: product }))
    await createCatalogClient({ fetch }).products.detail(id)
    expect(fetch.mock.calls[0][0]).toBe(`http://127.0.0.1:5001/api/products/${id}`)
  })
  it.each([0, -1, NaN, Infinity, 0.5, 2147483648])('rejects invalid timeout %s', timeoutMs => {
    expect(() => createCatalogClient({ baseUrl: 'http://localhost:5000', timeoutMs })).toThrowError(CatalogApiError)
  })
})

describe('HTTP contracts', () => {
  const cases = [
    ['ingredients.list', 'GET', '/ingredients', undefined, ingredient, true],
    ['ingredients.detail', 'GET', `/ingredients/${id}`, undefined, ingredient, false],
    ['ingredients.create', 'POST', '/ingredients', ingredientInput, ingredient, false],
    ['ingredients.update', 'PATCH', `/ingredients/${id}`, { costPrice: '0.0001', isActive: false }, ingredient, false],
    ['ingredients.softDelete', 'DELETE', `/ingredients/${id}`, undefined, ingredient, false],
    ['products.list', 'GET', '/products', undefined, product, true],
    ['products.detail', 'GET', `/products/${id}`, undefined, product, false],
    ['products.create', 'POST', '/products', productInput, product, false],
    ['products.update', 'PATCH', `/products/${id}`, { description: '', imageUrl: '', isAvailable: false }, product, false],
    ['products.softDelete', 'DELETE', `/products/${id}`, undefined, product, false],
    ['recipes.list', 'GET', '/recipes', undefined, recipe, true],
    ['recipes.detail', 'GET', `/recipes/${id}`, undefined, recipe, false],
    ['recipes.create', 'POST', '/recipes', recipeInput, recipe, false],
    ['recipes.activate', 'POST', `/recipes/${id}/activate`, undefined, recipe, false],
    ['recipes.deactivate', 'POST', `/recipes/${id}/deactivate`, undefined, recipe, false],
  ] as const
  it.each(cases)('%s sends the exact method/path/payload and preserves the envelope', async (operation, method, path, payload, record, listing) => {
    const response = listing ? { data: [record], pagination } : { data: record }
    const { client, fetch } = setup(response, operation.endsWith('create') ? 201 : 200)
    // A test-only dynamic dispatcher exercises every public endpoint uniformly.
    const [resource, action] = operation.split('.')
    const fn = (client[resource as keyof typeof client] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[action]
    const args = action === 'list' ? [] : action === 'create' ? [payload] : action === 'update' ? [id, payload] : [id]
    expect(await fn(...args)).toEqual(response)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`http://127.0.0.1:5000/api${path}`)
    expect(init).toMatchObject({ method, credentials: 'omit', redirect: 'error' })
    expect(init?.body).toBe(payload === undefined ? undefined : JSON.stringify(payload))
    expect(init?.headers).toEqual({ Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('serializes all ingredient filters, sort, pagination, reserved characters and false', async () => {
    const { client, fetch } = setup({ data: [], pagination: { page: 3, limit: 5, total: 0, totalPages: 0 } })
    await client.ingredients.list({ page: 3, limit: 5, category: 'A&B', unit: 'g', isActive: false, search: 'sữa +%_?#', sortBy: 'costPrice', sortOrder: 'desc' })
    const query = new URL(fetch.mock.calls[0][0] as string).searchParams
    expect(Object.fromEntries(query)).toEqual({ page: '3', limit: '5', category: 'A&B', unit: 'g', isActive: 'false', search: 'sữa +%_?#', sortBy: 'costPrice', sortOrder: 'desc' })
  })
  it('preserves false and empty product filters while omitting undefined', async () => {
    const { client, fetch } = setup({ data: [], pagination: { ...pagination, total: 0, totalPages: 0 } })
    await client.products.list({ page: 1, limit: 20, isAvailable: false, category: '', search: undefined })
    expect(new URL(fetch.mock.calls[0][0] as string).search).toBe('?page=1&limit=20&isAvailable=false&category=')
  })
  it('serializes recipe filters as raw UUIDs and false', async () => {
    const { client, fetch } = setup({ data: [recipe], pagination })
    await client.recipes.list({ page: 1, limit: 20, productId: otherId, size: 'L', isActive: false })
    expect(Object.fromEntries(new URL(fetch.mock.calls[0][0] as string).searchParams)).toEqual({ page: '1', limit: '20', productId: otherId, size: 'L', isActive: 'false' })
  })
  it('does not drop zero query values before backend validation', async () => {
    const { client, fetch } = setup({ error: 'Invalid request' }, 400)
    await expect(client.products.list({ page: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(new URL(fetch.mock.calls[0][0] as string).search).toBe('?page=0')
  })
  it.each([NaN, Infinity, 1.5, null, ['a'], { a: 1 }])('rejects non-scalar/invalid query values %s', value => {
    const { client, fetch } = setup()
    expect(() => client.ingredients.list({ page: value as number })).toThrowError(CatalogApiError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves server list and nested ordering without sorting', async () => {
    const first = { ...recipe, _id: otherId, size: 'L', ingredients: [...recipe.ingredients].reverse() }
    const second = { ...recipe, size: 'M', version: 9 }
    const { client } = setup({ data: [first, second], pagination: { ...pagination, total: 2 } })
    expect((await client.recipes.list()).data).toEqual([first, second])
    const { client: products } = setup({ data: product })
    expect((await products.products.detail(id)).data.prices).toEqual(product.prices)
  })
  it('preserves page metadata including pages past the end', async () => {
    const page = { page: 9, limit: 2, total: 3, totalPages: 2 }
    const { client } = setup({ data: [], pagination: page })
    expect(await client.products.list({ page: 9, limit: 2 })).toEqual({ data: [], pagination: page })
  })
  it.each([{ description: undefined, imageUrl: undefined }, { description: '', imageUrl: '' }, { description: 'Fresh tea', imageUrl: 'https://example.test/tea.png' }])('accepts optional product fields %s', async fields => {
    const expected = { ...product, ...fields }
    const { client } = setup({ data: expected })
    expect((await client.products.detail(id)).data).toEqual(JSON.parse(JSON.stringify(expected)))
  })
  it('exposes string decimals and raw UUIDs in public types', () => {
    expectTypeOf<Ingredient['costPrice']>().toEqualTypeOf<string>()
    expectTypeOf<Product['prices'][number]['price']>().toEqualTypeOf<string>()
    expectTypeOf<Recipe['ingredients'][number]['quantity']>().toEqualTypeOf<string>()
    expectTypeOf<Recipe['productId']>().toEqualTypeOf<string>()
  })
})

describe('response and payload validation', () => {
  it.each(['507f1f77bcf86cd799439011', '../recipes', '', 'not-a-uuid'])('rejects invalid path ID %s before HTTP', value => {
    const { client, fetch } = setup()
    expect(() => client.ingredients.detail(value)).toThrowError(CatalogApiError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('accepts uppercase UUIDs without converting them to Mongo IDs', async () => {
    const { client } = setup({ data: { ...ingredient, _id: id.toUpperCase() } })
    expect((await client.ingredients.detail(id.toUpperCase())).data._id).toBe(id.toUpperCase())
  })
  it.each([0.1, '01', '1.00', '1e3', '-1', 'NaN', '0.00001', '100000000000000', null])('rejects noncanonical/out-of-range response decimals %s', async costPrice => {
    const { client } = setup({ data: { ...ingredient, costPrice } })
    await expect(client.ingredients.detail(id)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
  it.each([
    ['ingredients', { ...ingredient, _id: '507f1f77bcf86cd799439011' }],
    ['ingredients', { ...ingredient, __v: 0 }],
    ['ingredients', { ...ingredient, minStock: 0.5 }],
    ['ingredients', { ...ingredient, createdAt: 'yesterday' }],
    ['ingredients', { ...ingredient, unit: 'kg' }],
    ['products', { ...product, prices: [{ size: 'S', price: 10 }] }],
    ['products', { ...product, prices: [product.prices[0], product.prices[0]] }],
    ['products', { ...product, description: null }],
    ['products', { ...product, imageUrl: null }],
    ['recipes', { ...recipe, productId: { _id: otherId } }],
    ['recipes', { ...recipe, ingredients: [{ ingredientId: { _id: id }, quantity: '1' }] }],
    ['recipes', { ...recipe, ingredients: [{ ingredientId: id, quantity: '0' }] }],
    ['recipes', { ...recipe, ingredients: [recipe.ingredients[0], recipe.ingredients[0]] }],
    ['recipes', { ...recipe, version: 0 }],
    ['recipes', { ...recipe, isActive: 'false' }],
  ] as const)('rejects incompatible %s records %#', async (resource, value) => {
    const { client } = setup({ data: value })
    await expect(client[resource].detail(id)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
  it.each([null, {}, { data: null }, { data: ingredient },
    { data: [], pagination: { ...pagination, page: 0 } },
    { data: [], pagination: { ...pagination, limit: 101 } },
    { data: [], pagination: { ...pagination, total: -1 } },
    { data: [], pagination: { ...pagination, totalPages: 3 } },
    { data: [], pagination: { ...pagination, total: '1' } },
  ])('rejects malformed list envelopes %#', async value => {
    const { client } = setup(value)
    await expect(client.ingredients.list()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
  it.each([
    ['invalid JSON', '{', 'application/json'],
    ['HTML', '<html>internal details</html>', 'text/html'],
    ['missing content type', '{}', ''],
  ])('normalizes %s', async (_, body, contentType) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { headers: { 'Content-Type': contentType } }))
    const client = createCatalogClient({ baseUrl: 'http://localhost', fetch })
    await expect(client.products.detail(id)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE', status: 200 })
  })
  it('rejects numeric mutation decimals even for untyped callers', () => {
    const { client, fetch } = setup()
    expect(() => client.ingredients.create({ ...ingredientInput, costPrice: 0.1 } as unknown as IngredientInput)).toThrowError(CatalogApiError)
    expect(() => client.products.update(id, { prices: [{ size: 'S', price: 0.1 }] } as unknown as ProductInput)).toThrowError(CatalogApiError)
    expect(() => client.recipes.create({ ...recipeInput, ingredients: [{ ingredientId: id, quantity: 0.1 }] } as unknown as RecipeInput)).toThrowError(CatalogApiError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends accepted decimal strings byte-for-byte without canonicalizing or rounding', async () => {
    const { client, fetch } = setup()
    await client.ingredients.update(id, { costPrice: '0001.2300', minStock: '0.000001' })
    expect(fetch.mock.calls[0][1]?.body).toBe('{"costPrice":"0001.2300","minStock":"0.000001"}')
  })
})

describe('historical Recipe read compatibility', () => {
  const emptyRecipe: Recipe = { ...recipe, version: 3, ingredients: [] }

  it.each(['detail', 'list'] as const)('accepts an empty historical Recipe via %s using GET only', async operation => {
    const response = operation === 'list' ? { data: [emptyRecipe], pagination } : { data: emptyRecipe }
    const { client, fetch } = setup(response)
    const result = operation === 'list' ? await client.recipes.list() : await client.recipes.detail(id)
    expect(result).toEqual(response)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' })
    expect(fetch.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('preserves mixed empty/populated Recipe order, exact quantities, pagination and false filters', async () => {
    const populated = { ...recipe, _id: otherId }
    const response = { data: [emptyRecipe, populated], pagination: { page: 2, limit: 2, total: 5, totalPages: 3 } }
    const { client, fetch } = setup(response)
    const result = await client.recipes.list({ productId: recipe.productId, size: 'L', isActive: false, page: 2, limit: 2 })
    expect(result).toEqual(response)
    expect(result.data[1].ingredients.map(item => item.quantity)).toEqual(['0.000001', '999999999999.999999'])
    expect(Object.fromEntries(new URL(String(fetch.mock.calls[0][0])).searchParams)).toEqual({
      productId: recipe.productId, size: 'L', isActive: 'false', page: '2', limit: '2',
    })
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET' && init.body === undefined)).toBe(true)
  })

  it.each([
    { _id: '507f1f77bcf86cd799439011' },
    { productId: { _id: otherId } },
    { productId: 'not-a-uuid' },
    { size: 'XL' },
    { version: 0 },
    { version: -1 },
    { version: 1.5 },
    { version: '1' },
    { createdAt: 'yesterday' },
    { updatedAt: undefined },
    { isActive: 'false' },
    { __v: 0 },
    { ingredients: undefined },
    { ingredients: null },
    { ingredients: {} },
    { ingredients: [null] },
    { ingredients: [{ ingredientId: 'not-a-uuid', quantity: '1' }] },
    { ingredients: [{ ingredientId: { _id: id }, quantity: '1' }] },
    { ingredients: [{ ingredientId: id, quantity: 1 }] },
    { ingredients: [{ ingredientId: id, quantity: '0' }] },
    { ingredients: [{ ingredientId: id, quantity: '1.0' }] },
    { ingredients: [{ ingredientId: id, quantity: '0.0000001' }] },
    { ingredients: [{ ingredientId: id, quantity: '1000000000000' }] },
    { ingredients: [recipe.ingredients[0], recipe.ingredients[0]] },
  ])('continues rejecting malformed Recipe metadata or members %#', async override => {
    const { client } = setup({ data: { ...emptyRecipe, ...override } })
    await expect(client.recipes.detail(id)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE', status: 200 })
  })

  it('rejects a malformed list record instead of dropping it beside a valid empty Recipe', async () => {
    const { client } = setup({ data: [emptyRecipe, { ...recipe, productId: null }], pagination: { ...pagination, total: 2 } })
    await expect(client.recipes.list()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('still reports backend rejection of empty creation without changing its payload or retrying', async () => {
    const input: RecipeInput = { ...recipeInput, ingredients: [] }
    const { client, fetch } = setup({ error: 'Invalid request' }, 400)
    await expect(client.recipes.create(input)).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) })
  })

  it.each(['create', 'activate', 'deactivate'] as const)('preserves the existing nonempty %s response guard', async operation => {
    const { client, fetch } = setup({ data: emptyRecipe })
    const response = operation === 'create' ? client.recipes.create(recipeInput) : client.recipes[operation](id)
    await expect(response).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('safe errors and single-attempt requests', () => {
  it.each([[400, 'BAD_REQUEST'], [404, 'NOT_FOUND'], [409, 'CONFLICT'], [500, 'SERVER_ERROR'], [503, 'SERVER_ERROR'], [401, 'HTTP_ERROR']])('normalizes status %s without exposing internals', async (status, code) => {
    const secret = 'postgresql://user:password@localhost/private SELECT * FROM secrets'
    const { client, fetch } = setup({ error: secret, stack: secret }, status as number)
    const error = await client.recipes.create(recipeInput).catch(e => e)
    expect(error).toBeInstanceOf(CatalogApiError)
    expect(error).toMatchObject({ code, status })
    expect(String(error) + JSON.stringify(error)).not.toContain(secret)
    expect(error.cause).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps HTTP status classification for malformed error bodies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('<html>private</html>', { status: 500 }))
    const client = createCatalogClient({ baseUrl: 'http://localhost', fetch })
    await expect(client.recipes.activate(id)).rejects.toMatchObject({ code: 'SERVER_ERROR', status: 500 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['create', 'activate', 'deactivate'] as const)('does not retry recipe %s on network failure', async action => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('private connection credentials'))
    const client = createCatalogClient({ baseUrl: 'http://localhost', fetch })
    const promise = action === 'create' ? client.recipes.create(recipeInput) : client.recipes[action](id)
    const error = await promise.catch(e => e)
    expect(error).toMatchObject({ code: 'NETWORK' })
    expect(String(error)).not.toContain('credentials')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['headers', 'body'] as const)('times out while waiting for %s, aborts, and never retries', async stage => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>()
    if (stage === 'headers') fetch.mockImplementation(() => new Promise(() => {}))
    else {
      const response = json({ data: recipe })
      vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}))
      fetch.mockResolvedValue(response)
    }
    const client = createCatalogClient({ baseUrl: 'http://localhost', timeoutMs: 50, fetch })
    const outcome = expect(client.recipes.activate(id)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50)
    await outcome
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up the timer after success and failure', async () => {
    vi.useFakeTimers()
    const { client } = setup()
    await client.ingredients.detail(id)
    expect(vi.getTimerCount()).toBe(0)
    const { client: failed } = setup({ error: 'Conflict' }, 409)
    await expect(failed.ingredients.softDelete(id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
