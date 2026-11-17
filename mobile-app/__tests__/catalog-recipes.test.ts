import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createCatalogClient } from '../src/api/catalog.ts';
import type { Ingredient, PageEnvelope, Product, Recipe } from '../src/api/catalog.types.ts';
import { createIngredientListController } from '../src/ingredients/ingredient.controller.ts';
import { createProductListController } from '../src/products/product.controller.ts';
import { createRecipeDetailController, createRecipeListController } from '../src/recipes/recipe.controller.ts';
import { ingredientMetadata, productMetadata, recipeDetailFields, recipeListFields, recipeQuery } from '../src/recipes/recipe.model.ts';
import { createRecipeReferences, readRecipeReference } from '../src/recipes/recipe.references.ts';
import { ingredient, ingredientId, metadata, otherId, product, productId, recipe, recipeId } from './fixtures/catalog.ts';

const baseUrl = 'http://127.0.0.1:5000/api';
const secondRecipeId = '52345678-1234-1234-1234-123456789abc';
const secondProductId = '62345678-1234-1234-1234-123456789abc';
const secondIngredientId = '72345678-1234-1234-1234-123456789abc';
const secondRecipe: Recipe = { ...recipe, _id: secondRecipeId, productId: secondProductId, size: 'S', version: 1, isActive: true,
  ingredients: [{ ingredientId: secondIngredientId, quantity: '1.000001' }] };
const emptyRecipe: Recipe = { ...recipe, _id: secondRecipeId, ingredients: [], version: 7, isActive: false };
const secondProduct: Product = { ...product, _id: secondProductId, code: 'COFFEE', name: 'Coffee', isAvailable: true };
const secondIngredient: Ingredient = { ...ingredient, _id: secondIngredientId, code: 'BEAN', name: 'Bean', unit: 'g', isActive: true };

let forbiddenFetchCalls = 0;
const forbiddenFetch = mock.fn(async () => { forbiddenFetchCalls++; throw new Error('Unmocked network access'); });

beforeEach(() => { forbiddenFetchCalls = 0; globalThis.fetch = forbiddenFetch; });
afterEach(() => { mock.timers.reset(); mock.reset(); });

function json(value: unknown, status = 200, url = '') {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } ,
    ...(url ? {} : {}) });
}

function response(value: unknown, url: URL, status = 200) {
  const result = json(value, status);
  Object.defineProperty(result, 'url', { value: url.href });
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
}

function page(rows: readonly Recipe[], url: URL): PageEnvelope<Recipe> {
  const pageNumber = Number(url.searchParams.get('page') ?? 1);
  const limit = Number(url.searchParams.get('limit') ?? 20);
  return { data: rows, pagination: { page: pageNumber, limit, total: rows.length, totalPages: rows.length ? 1 : 0 } };
}

function setup(options: {
  recipes?: readonly Recipe[];
  products?: readonly Product[];
  ingredients?: readonly Ingredient[];
  timeoutMs?: number;
  intercept?: (url: URL) => Response | Promise<Response> | undefined;
} = {}) {
  const recipes = options.recipes ?? [recipe];
  const products = options.products ?? [product, secondProduct];
  const ingredients = options.ingredients ?? [ingredient, secondIngredient];
  const urls: URL[] = [];
  const fetch = mock.fn<typeof globalThis.fetch>(async (input, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.body, undefined);
    const url = new URL(String(input));
    urls.push(url);
    const intercepted = options.intercept?.(url);
    if (intercepted) return intercepted;
    if (url.pathname === '/api/recipes') return response(page(recipes, url), url);
    const recipeRecord = recipes.find(row => url.pathname.toLowerCase() === `/api/recipes/${row._id}`.toLowerCase());
    if (recipeRecord) return response({ data: recipeRecord }, url);
    const productRecord = products.find(row => url.pathname.toLowerCase() === `/api/products/${row._id}`.toLowerCase());
    if (productRecord) return response({ data: productRecord }, url);
    const ingredientRecord = ingredients.find(row => url.pathname.toLowerCase() === `/api/ingredients/${row._id}`.toLowerCase());
    if (ingredientRecord) return response({ data: ingredientRecord }, url);
    return response({ error: 'private missing reference' }, url, 404);
  });
  const client = createCatalogClient({ baseUrl, timeoutMs: options.timeoutMs, fetch });
  return { client, factory: () => client, fetch, urls };
}

describe('Recipe query and exact historical presentation', () => {
  it('omits all filters and maps explicit Product, size, active and inactive filters without search or sort', () => {
    assert.deepEqual(recipeQuery({ productId: ' ', size: 'all', status: 'all' }), { page: 1, limit: 20 });
    assert.deepEqual(recipeQuery({ productId: ` ${productId} `, size: 'M', status: 'active' }),
      { page: 1, limit: 20, productId, size: 'M', isActive: true });
    assert.deepEqual(recipeQuery({ productId: productId, size: 'L', status: 'inactive' }, 2),
      { page: 2, limit: 20, productId, size: 'L', isActive: false });
    assert.ok(!('search' in recipeQuery({ productId: '', size: 'all', status: 'all' })));
    assert.ok(!('sortBy' in recipeQuery({ productId: '', size: 'all', status: 'all' })));
  });

  for (const invalid of ['not-a-uuid', '507f1f77bcf86cd799439011', `${productId}\0`]) {
    it(`rejects invalid Product UUID filter ${JSON.stringify(invalid)}`, () => {
      assert.throws(() => recipeQuery({ productId: invalid, size: 'all', status: 'all' }));
    });
  }

  it('presents server version/status and exact quantity strings without treating the highest version as active', () => {
    const fields = Object.fromEntries(recipeDetailFields(recipe).map(field => [field.label, field.value]));
    assert.equal(fields.Version, '2');
    assert.equal(fields.Status, 'Inactive');
    assert.equal(recipe.ingredients[0].quantity, '999999999999.999999');
    assert.equal(recipe.ingredients[1].quantity, '0.000001');
    assert.equal(Object.fromEntries(recipeListFields(emptyRecipe).map(field => [field.label, field.value]))['Ingredient membership'],
      'No ingredients in this historical version');
  });

  it('labels resolved values as current metadata and preserves unavailable/inactive states', () => {
    assert.deepEqual(Object.fromEntries(productMetadata(product).map(field => [field.label, field.value])), {
      'Current Product name': 'Tea', 'Current Product code': 'TEA', 'Current Product availability': 'Unavailable',
    });
    assert.deepEqual(Object.fromEntries(ingredientMetadata(ingredient).map(field => [field.label, field.value])), {
      'Current Ingredient name': 'Milk', 'Current Ingredient code': 'MILK', 'Current Ingredient unit': 'ml',
      'Current Ingredient status': 'Inactive',
    });
  });
});

describe('Recipe list GET state', () => {
  it('sends only supported GET filters, retains explicit false, preserves backend order and resolves duplicate Product references once', async () => {
    const rows = [{ ...recipe, _id: secondRecipeId }, recipe,
      { ...recipe, _id: '82345678-1234-1234-1234-123456789abc' }];
    const { factory, urls, fetch } = setup({ recipes: rows });
    const controller = createRecipeListController(factory);
    controller.updateDraft({ productId, size: 'L', status: 'inactive' });
    await controller.apply();
    assert.equal(fetch.mock.calls.length, 0);
    await controller.focus();
    await settle();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data.map(row => row._id), rows.map(row => row._id));
    assert.equal(urls[0].pathname, '/api/recipes');
    assert.equal(urls[0].searchParams.get('productId'), productId);
    assert.equal(urls[0].searchParams.get('size'), 'L');
    assert.equal(urls[0].searchParams.get('isActive'), 'false');
    assert.equal(urls[0].searchParams.get('search'), null);
    assert.equal(urls[0].searchParams.get('sortBy'), null);
    assert.equal(urls.filter(url => url.pathname === `/api/products/${productId}`).length, 1);
    assert.equal(readRecipeReference(controller.getSnapshot().references.products, productId)?.data?.isAvailable, false);
    controller.dispose();
  });

  it('Apply and Reset return to page one while paging uses applied filters rather than unsaved drafts', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ ...recipe, size: 'S' as const, isActive: true,
      _id: `${String(index + 1).padStart(8, '0')}-1234-1234-1234-123456789abc` }));
    const { client, urls } = setup({ recipes: rows, intercept: url => {
      if (url.pathname !== '/api/recipes') return;
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const data = pageNumber === 1 ? rows.slice(0, 20) : rows.slice(20);
      return response({ data, pagination: { page: pageNumber, limit: 20, total: 21, totalPages: 2 } }, url);
    }});
    const controller = createRecipeListController(() => client);
    controller.updateDraft({ size: 'S', status: 'active' });
    await controller.apply(); await controller.focus();
    controller.updateDraft({ size: 'L', status: 'inactive' });
    await controller.nextPage();
    assert.equal(controller.getSnapshot().query.page, 2);
    assert.equal(urls.filter(url => url.pathname === '/api/recipes').at(-1)?.searchParams.get('size'), 'S');
    assert.equal(urls.filter(url => url.pathname === '/api/recipes').at(-1)?.searchParams.get('isActive'), 'true');
    await controller.reset();
    assert.deepEqual(controller.getSnapshot().query, { page: 1, limit: 20 });
    controller.dispose();
  });

  it('keeps the applied list and avoids a request when Product UUID validation fails', async () => {
    const { factory, fetch } = setup();
    const controller = createRecipeListController(factory);
    await controller.focus();
    const before = controller.getSnapshot().snapshot.data;
    controller.updateDraft({ productId: 'invalid' });
    await controller.apply();
    assert.ok(controller.getSnapshot().validationError);
    assert.deepEqual(controller.getSnapshot().snapshot.data, before);
    assert.equal(fetch.mock.calls.filter(call => String(call.arguments[0]).includes('/recipes')).length, 1);
    controller.dispose();
  });

  it('preserves settled filters, page, results and references across detail navigation', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ ...recipe, _id: `${String(index + 1).padStart(8, '0')}-1234-1234-1234-123456789abc` }));
    const { client } = setup({ recipes: rows, intercept: url => {
      if (url.pathname !== '/api/recipes') return;
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const data = pageNumber === 1 ? rows.slice(0, 20) : rows.slice(20);
      return response({ data, pagination: { page: pageNumber, limit: 20, total: 21, totalPages: 2 } }, url);
    }});
    const list = createRecipeListController(() => client);
    list.updateDraft({ productId, status: 'inactive' });
    await list.apply(); await list.focus(); await list.nextPage(); await settle();
    const before = list.getSnapshot();
    list.blur();
    const detail = createRecipeDetailController(rows[20]._id, () => client);
    await detail.focus(); await settle(); detail.dispose();
    await list.focus();
    assert.deepEqual(list.getSnapshot(), before);
    list.dispose();
  });

  it('keeps Recipe state independent from Ingredient and Product state', async () => {
    const { client } = setup();
    const recipes = createRecipeListController(() => client);
    recipes.updateDraft({ size: 'L', status: 'inactive' });
    await recipes.apply(); await recipes.focus(); await settle();
    const before = recipes.getSnapshot();
    const products = createProductListController(() => client);
    const ingredients = createIngredientListController(() => client);
    await products.focus(); await products.reset(); products.dispose();
    await ingredients.focus(); await ingredients.reset(); ingredients.dispose();
    assert.deepEqual(recipes.getSnapshot(), before);
    recipes.dispose();
  });
});

describe('Recipe detail and reference resolution', () => {
  for (const value of [undefined, null, 'not-a-uuid', [recipeId], [recipeId, secondRecipeId]]) {
    it(`rejects ambiguous/invalid detail parameter ${JSON.stringify(value)} before client creation`, async () => {
      const factory = mock.fn(() => { throw new Error('must remain lazy'); });
      const controller = createRecipeDetailController(value, factory);
      assert.equal(controller.getSnapshot().invalidId, true);
      await controller.focus(); await controller.retry();
      assert.equal(factory.mock.calls.length, 0);
      controller.dispose();
    });
  }

  it('loads inactive direct detail links, raw references, exact quantities and current metadata using GET only', async () => {
    const { factory, urls } = setup();
    const controller = createRecipeDetailController(recipeId.toUpperCase(), factory);
    await controller.focus(); await settle();
    const state = controller.getSnapshot();
    assert.equal(state.snapshot.data?.data.isActive, false);
    assert.equal(state.snapshot.data?.data.ingredients[0].quantity, '999999999999.999999');
    assert.equal(readRecipeReference(state.references.products, productId)?.data?.code, product.code);
    assert.equal(readRecipeReference(state.references.ingredients, ingredientId)?.data?.isActive, false);
    assert.equal(readRecipeReference(state.references.ingredients, otherId)?.status, 'error');
    assert.equal(urls[0].pathname, `/api/recipes/${recipeId.toUpperCase()}`);
    controller.dispose();
  });

  it('accepts historical Recipes with empty membership and performs no Ingredient lookup', async () => {
    const { factory, urls } = setup({ recipes: [emptyRecipe] });
    const controller = createRecipeDetailController(emptyRecipe._id, factory);
    await controller.focus(); await settle();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data.ingredients, []);
    assert.equal(controller.getSnapshot().references.ingredients.size, 0);
    assert.equal(urls.some(url => url.pathname.startsWith('/api/ingredients/')), false);
    controller.dispose();
  });

  it('keeps Recipe data visible when Product and Ingredient references are missing, and retries each failure independently', async () => {
    let referencesAvailable = false;
    const { factory, urls } = setup({ recipes: [recipe], products: [], ingredients: [], intercept: url => {
      if (!referencesAvailable || url.pathname.startsWith('/api/recipes')) return;
      if (url.pathname === `/api/products/${productId}`) return response({ data: product }, url);
      if (url.pathname === `/api/ingredients/${ingredientId}`) return response({ data: ingredient }, url);
      return response({ data: { ...ingredient, _id: otherId } }, url);
    }});
    const controller = createRecipeDetailController(recipeId, factory);
    await controller.focus(); await settle();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(readRecipeReference(controller.getSnapshot().references.products, productId)?.status, 'error');
    assert.equal(readRecipeReference(controller.getSnapshot().references.ingredients, ingredientId)?.status, 'error');
    const before = urls.length;
    await controller.focus(); await settle();
    assert.equal(urls.length, before);
    referencesAvailable = true;
    controller.retryProduct(productId);
    controller.retryIngredient(ingredientId);
    await settle();
    assert.equal(readRecipeReference(controller.getSnapshot().references.products, productId)?.status, 'success');
    assert.equal(readRecipeReference(controller.getSnapshot().references.ingredients, ingredientId)?.status, 'success');
    assert.equal(readRecipeReference(controller.getSnapshot().references.ingredients, otherId)?.status, 'error');
    controller.dispose();
  });

  it('deduplicates case-insensitive references and bounds concurrent reference reads', async () => {
    const pending: Array<ReturnType<typeof deferred<{ data: Product }>>> = [];
    let running = 0, maximum = 0;
    const products = {
      detail: mock.fn(async () => {
        running++; maximum = Math.max(maximum, running);
        const wait = deferred<{ data: Product }>(); pending.push(wait);
        const result = await wait.promise; running--; return result;
      }), list: mock.fn(),
    };
    const ingredients = { detail: mock.fn(), list: mock.fn() };
    const resolver = createRecipeReferences(() => ({ products, ingredients }) as never, () => {}, 2);
    resolver.replace([productId, productId.toUpperCase(), secondProductId, otherId]);
    resolver.focus(); await settle();
    assert.equal(products.detail.mock.calls.length, 2);
    assert.equal(maximum, 2);
    pending.splice(0).forEach((wait, index) => wait.resolve({ data: index ? secondProduct : product }));
    await settle();
    assert.equal(products.detail.mock.calls.length, 3);
    assert.equal(resolver.getSnapshot().products.size, 3);
    pending.splice(0).forEach(wait => wait.resolve({ data: product }));
    await settle(); resolver.dispose();
  });

  it('suppresses an old reference revision and starts the replacement queue when cancelled work settles', async () => {
    const first = deferred<{ data: Product }>();
    const products = { detail: mock.fn((id: string) => id === productId ? first.promise : Promise.resolve({ data: secondProduct })), list: mock.fn() };
    const ingredients = { detail: mock.fn(), list: mock.fn() };
    const resolver = createRecipeReferences(() => ({ products, ingredients }) as never, () => {}, 1);
    resolver.replace([productId]); resolver.focus(); await settle();
    resolver.replace([secondProductId]);
    first.resolve({ data: product }); await settle();
    assert.equal(products.detail.mock.calls.length, 2);
    assert.equal(readRecipeReference(resolver.getSnapshot().products, productId), undefined);
    assert.equal(readRecipeReference(resolver.getSnapshot().products, secondProductId)?.data?.code, secondProduct.code);
    resolver.dispose();
  });
});

describe('Recipe failures, cancellation and stale suppression', () => {
  for (const cause of ['not-found', 'malformed'] as const) {
    it(`retains a safe ${cause} detail failure until explicit retry`, async () => {
      let failed = true;
      const { factory, fetch } = setup({ intercept: url => failed && url.pathname.endsWith(recipeId)
        ? cause === 'not-found' ? response({ error: 'private detail' }, url, 404)
          : response({ data: { ...recipe, ingredients: [{ ingredientId, quantity: 1 }] } }, url) : undefined });
      const controller = createRecipeDetailController(recipeId, factory);
      await controller.focus();
      assert.equal(controller.getSnapshot().snapshot.error?.code, cause === 'not-found' ? 'NOT_FOUND' : 'MALFORMED_RESPONSE');
      await controller.focus();
      assert.equal(fetch.mock.calls.length, 1);
      failed = false; await controller.retry(); await settle();
      assert.equal(controller.getSnapshot().snapshot.status, 'success');
      controller.dispose();
    });
  }

  it('times out without automatic retry and succeeds only after explicit retry', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    let failed = true;
    const { factory, fetch } = setup({ timeoutMs: 20, intercept: url => url.pathname.endsWith(recipeId) && failed ? pending.promise : undefined });
    const controller = createRecipeDetailController(recipeId, factory);
    const work = controller.focus(); mock.timers.tick(21); await work;
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'TIMEOUT');
    await controller.focus(); assert.equal(fetch.mock.calls.length, 1);
    failed = false; await controller.retry(); await settle();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    pending.resolve(response({ data: recipe }, new URL(`${baseUrl}/recipes/${recipeId}`)));
    controller.dispose();
  });

  it('cancels pending Recipe and reference reads on blur and performs no off-screen retry', async () => {
    const recipePending = deferred<Response>();
    const { factory, fetch } = setup({ intercept: url => url.pathname.endsWith(recipeId) ? recipePending.promise : undefined });
    const controller = createRecipeDetailController(recipeId, factory);
    const work = controller.focus(); controller.blur(); await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    await controller.retry(); assert.equal(fetch.mock.calls.length, 1);
    recipePending.resolve(response({ data: recipe }, new URL(`${baseUrl}/recipes/${recipeId}`)));
    controller.dispose();
  });

  for (const outcome of ['success', 'failure'] as const) {
    it(`ignores stale Recipe list ${outcome} after newer filters`, async () => {
      const old = deferred<Response>();
      const { factory } = setup({ intercept: url => url.pathname === '/api/recipes' && url.searchParams.get('size') === 'S' ? old.promise : undefined });
      const controller = createRecipeListController(factory);
      controller.updateDraft({ size: 'S' }); await controller.apply();
      const first = controller.focus();
      controller.updateDraft({ size: 'L' }); const current = controller.apply();
      assert.equal(controller.getSnapshot().snapshot.status, 'loading');
      assert.equal(controller.getSnapshot().snapshot.data, undefined);
      assert.equal(controller.getSnapshot().references.products.size, 0);
      await current;
      if (outcome === 'success') old.resolve(response(page([secondRecipe], new URL(`${baseUrl}/recipes?page=1&limit=20&size=S`)), new URL(`${baseUrl}/recipes?page=1&limit=20&size=S`)));
      else old.reject(new Error('late private failure'));
      await first; await settle();
      assert.equal(controller.getSnapshot().query.size, 'L');
      assert.equal(controller.getSnapshot().snapshot.data?.data[0]._id, recipeId);
      assert.equal(controller.getSnapshot().snapshot.error, undefined);
      controller.dispose();
    });
  }

  it('ignores stale reference success after navigation disposal', async () => {
    const pending = deferred<Response>();
    const { factory } = setup({ intercept: url => url.pathname === `/api/products/${productId}` ? pending.promise : undefined });
    const old = createRecipeDetailController(recipeId, factory);
    let notifications = 0; old.subscribe(() => { notifications++; });
    await old.focus(); await settle();
    old.dispose(); const count = notifications;
    pending.resolve(response({ data: product }, new URL(`${baseUrl}/products/${productId}`)));
    await settle();
    assert.equal(notifications, count);
  });
});
