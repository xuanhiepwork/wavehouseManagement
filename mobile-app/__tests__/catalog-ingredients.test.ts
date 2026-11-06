import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createCatalogClient } from '../src/api/catalog.ts';
import type { Ingredient } from '../src/api/catalog.types.ts';
import { createIngredientDetailController, createIngredientListController } from '../src/ingredients/ingredient.controller.ts';
import {
  DEFAULT_INGREDIENT_DRAFT, ingredientDetailFields, ingredientListFields, ingredientQuery,
} from '../src/ingredients/ingredient.model.ts';
import type { IngredientDraft } from '../src/ingredients/ingredient.model.ts';
import { ingredient, ingredientId, otherId } from './fixtures/catalog.ts';

const baseUrl = 'http://127.0.0.1:5000/api';
const activeIngredient: Ingredient = { ...ingredient, isActive: true };
const secondIngredient: Ingredient = { ...ingredient, _id: otherId, code: 'SUGAR', name: 'Sugar', unit: 'g', costPrice: '0', minStock: '0.000001' };
const originalEnvironment = process.env.EXPO_PUBLIC_API_BASE_URL;
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
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalEnvironment;
  assert.equal(forbiddenFetchCalls, 0, 'Ingredient logic tests must never reach live fetch');
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function page(rows: readonly Ingredient[], url: URL) {
  const current = Number(url.searchParams.get('page') ?? '1');
  const limit = Number(url.searchParams.get('limit') ?? '20');
  return json({ data: rows.slice((current - 1) * limit, current * limit),
    pagination: { page: current, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
function setup(rows: readonly Ingredient[] = [activeIngredient], handler?: Handler, timeoutMs = 5_000) {
  const fetch = mock.fn<typeof globalThis.fetch>(async (input, initial) => {
    const init = initial ?? {};
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:5000');
    const override = handler?.(url, init);
    if (override !== undefined) return override;
    if (url.pathname === '/api/ingredients') {
      const active = url.searchParams.get('isActive') !== 'false';
      return page(rows.filter(row => row.isActive === active), url);
    }
    const record = rows.find(row => url.pathname.toLowerCase() === `/api/ingredients/${row._id.toLowerCase()}`);
    return record ? json({ data: record }) : json({ error: 'Not found' }, 404);
  });
  const client = createCatalogClient({ baseUrl, fetch, timeoutMs });
  const factory = mock.fn(() => ({ ingredients: client.ingredients }));
  return { client, fetch, factory, urls: () => fetch.mock.calls.map(call => new URL(String(call.arguments[0]))) };
}
function records(count: number) {
  return Array.from({ length: count }, (_, index): Ingredient => ({ ...activeIngredient,
    _id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, code: `ING${index + 1}`, name: `Ingredient ${index + 1}` }));
}

describe('applied Ingredient filter and presentation contracts', () => {
  it('omits blank filters and active status while keeping the supported default page and sort', () => {
    assert.deepEqual(ingredientQuery(DEFAULT_INGREDIENT_DRAFT), { page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' });
    assert.equal(ingredientQuery(DEFAULT_INGREDIENT_DRAFT).isActive, undefined);
  });
  it('trims search/category, retains reserved characters, and maps only supported filters', () => {
    assert.deepEqual(ingredientQuery({ ...DEFAULT_INGREDIENT_DRAFT, search: ' milk & sữa +%_?# ', category: ' Dairy ',
      unit: 'ml', status: 'inactive', sortBy: 'costPrice', sortOrder: 'desc' }, 3), {
      page: 3, limit: 20, search: 'milk & sữa +%_?#', category: 'Dairy', unit: 'ml', isActive: false, sortBy: 'costPrice', sortOrder: 'desc',
    });
  });
  for (const [status, expected] of [['default', undefined], ['active', true], ['inactive', false]] as const) {
    it(`maps ${status} to the exact backend active filter`, () => {
      assert.equal(ingredientQuery({ ...DEFAULT_INGREDIENT_DRAFT, status }).isActive, expected);
    });
  }
  for (const unit of ['g', 'ml', 'piece'] as const) {
    it(`supports the Ingredient unit ${unit}`, () => assert.equal(ingredientQuery({ ...DEFAULT_INGREDIENT_DRAFT, unit }).unit, unit));
  }
  for (const sortBy of ['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'] as const) {
    it(`supports sorting by ${sortBy} without rewriting that wire field`, () => {
      assert.deepEqual(ingredientQuery({ ...DEFAULT_INGREDIENT_DRAFT, sortBy, sortOrder: 'desc' }), {
        page: 1, limit: 20, sortBy, sortOrder: 'desc',
      });
    });
  }
  for (const patch of [{ search: 'milk\0' }, { category: '\0Dairy' }, { status: 'all' }, { unit: 'kg' }, { sortBy: 'uuid' }, { sortOrder: 'up' }]) {
    it(`rejects unsupported or invalid applied filters ${JSON.stringify(patch)}`, () => {
      assert.throws(() => ingredientQuery({ ...DEFAULT_INGREDIENT_DRAFT, ...patch } as IngredientDraft), { code: 'BAD_REQUEST' });
    });
  }
  for (const isActive of [true, false]) {
    it(`presents every list/detail field exactly for an ${isActive ? 'active' : 'inactive'} Ingredient`, () => {
      const value = { ...ingredient, isActive };
      const list = Object.fromEntries(ingredientListFields(value).map(field => [field.label, field.value]));
      assert.deepEqual(list, { Name: value.name, Code: value.code, Category: value.category, Unit: value.unit,
        Status: isActive ? 'Active' : 'Inactive', 'Cost price': '99999999999999.9999', 'Minimum stock': '999999999999.999999' });
      const detail = Object.fromEntries(ingredientDetailFields(value).map(field => [field.label, field.value]));
      assert.deepEqual(detail, { UUID: value._id, ...list, Created: value.createdAt, Updated: value.updatedAt });
      assert.ok(ingredientDetailFields(value).every(field => typeof field.value === 'string'));
    });
  }
  it('preserves canonical zero and the smallest stock decimal without rounding or unit conversion', () => {
    const fields = Object.fromEntries(ingredientDetailFields(secondIngredient).map(field => [field.label, field.value]));
    assert.equal(fields['Cost price'], '0');
    assert.equal(fields['Minimum stock'], '0.000001');
    assert.equal(fields.UUID, otherId);
    assert.equal(fields.Unit, 'g');
  });
});

describe('Ingredient list controller with the real mocked GET client', () => {
  it('constructs lazily, loads only on focus, and preserves the backend default active-only query', async () => {
    const { factory, fetch, urls } = setup([activeIngredient, secondIngredient]);
    const controller = createIngredientListController(factory);
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(factory.mock.calls.length, 0);
    assert.equal(fetch.mock.calls.length, 0);
    await controller.retry();
    assert.equal(fetch.mock.calls.length, 0);
    await controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, [activeIngredient]);
    assert.equal(urls()[0].pathname, '/api/ingredients');
    assert.equal(urls()[0].searchParams.has('isActive'), false);
    assert.deepEqual(Object.fromEntries(urls()[0].searchParams), { page: '1', limit: '20', sortBy: 'name', sortOrder: 'asc' });
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  it('keeps a draft separate from applied filters and resets page one only on explicit Apply', async () => {
    const { factory, fetch, urls } = setup(records(25));
    const controller = createIngredientListController(factory);
    await controller.focus();
    await controller.nextPage();
    assert.equal(controller.getSnapshot().query.page, 2);
    controller.updateDraft({ search: ' milk & tea ', category: ' Dairy ', unit: 'ml', status: 'inactive', sortBy: 'updatedAt', sortOrder: 'desc' });
    assert.equal(controller.getSnapshot().query.page, 2);
    assert.equal(controller.getSnapshot().query.search, undefined);
    assert.equal(fetch.mock.calls.length, 2);
    const applied = controller.apply();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(controller.getSnapshot().query.page, 1);
    await applied;
    assert.deepEqual(Object.fromEntries(urls().at(-1)!.searchParams), {
      page: '1', limit: '20', search: 'milk & tea', category: 'Dairy', unit: 'ml', isActive: 'false', sortBy: 'updatedAt', sortOrder: 'desc',
    });
    assert.equal(controller.getSnapshot().query.page, 1);
    controller.dispose();
  });
  it('keeps unapplied draft edits out of Next and Previous requests until Apply', async () => {
    const { factory, urls } = setup(records(41));
    const controller = createIngredientListController(factory);
    controller.updateDraft({ search: 'applied search', category: 'Dairy', status: 'active' });
    await controller.apply();
    await controller.focus();
    await controller.nextPage();
    controller.updateDraft({ search: 'pending search', category: 'Pending category', status: 'inactive' });
    await controller.nextPage();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '3');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'applied search');
    assert.equal(urls().at(-1)?.searchParams.get('category'), 'Dairy');
    assert.equal(urls().at(-1)?.searchParams.get('isActive'), 'true');
    await controller.previousPage();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '2');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'applied search');
    assert.equal(controller.getSnapshot().draft.search, 'pending search');
    await controller.apply();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '1');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'pending search');
    assert.equal(urls().at(-1)?.searchParams.get('isActive'), 'false');
    controller.dispose();
  });
  it('applies off-screen filters without reading until the list receives focus', async () => {
    const { factory, fetch, urls } = setup();
    const controller = createIngredientListController(factory);
    controller.updateDraft({ search: 'Milk', unit: 'ml' });
    await controller.apply();
    assert.equal(fetch.mock.calls.length, 0);
    assert.equal(controller.getSnapshot().query.search, 'Milk');
    await controller.focus();
    assert.equal(urls()[0].searchParams.get('search'), 'Milk');
    assert.equal(urls()[0].searchParams.get('unit'), 'ml');
    controller.dispose();
  });
  for (const status of ['active', 'inactive'] as const) {
    it(`requests explicit ${status} Ingredients without constructing a combined all-status query`, async () => {
      const { factory, urls } = setup([activeIngredient, secondIngredient]);
      const controller = createIngredientListController(factory);
      controller.updateDraft({ status });
      await controller.apply();
      await controller.focus();
      assert.equal(urls()[0].searchParams.get('isActive'), String(status === 'active'));
      assert.deepEqual(controller.getSnapshot().snapshot.data?.data, status === 'active' ? [activeIngredient] : [secondIngredient]);
      controller.dispose();
    });
  }
  it('resets filters, status and pagination while continuing to request GET only', async () => {
    const { factory, fetch, urls } = setup(records(25));
    const controller = createIngredientListController(factory);
    await controller.focus();
    await controller.nextPage();
    controller.updateDraft({ search: 'Milk', category: 'Dairy', unit: 'ml', status: 'inactive', sortBy: 'code', sortOrder: 'desc' });
    await controller.apply();
    const reset = controller.reset();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    await reset;
    assert.deepEqual(controller.getSnapshot().draft, DEFAULT_INGREDIENT_DRAFT);
    assert.deepEqual(controller.getSnapshot().query, ingredientQuery(DEFAULT_INGREDIENT_DRAFT));
    assert.equal(urls().at(-1)?.searchParams.has('isActive'), false);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET' && call.arguments[1]?.body === undefined));
    controller.dispose();
  });
  it('paginates in backend order and prevents Previous/Next requests past the reported boundaries', async () => {
    const rows = records(21);
    const { factory, fetch } = setup(rows);
    const controller = createIngredientListController(factory);
    await controller.focus();
    assert.equal(controller.getSnapshot().canPrevious, false);
    assert.equal(controller.getSnapshot().canNext, true);
    await controller.previousPage();
    assert.equal(fetch.mock.calls.length, 1);
    await controller.nextPage();
    assert.equal(controller.getSnapshot().query.page, 2);
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, [rows[20]]);
    assert.equal(controller.getSnapshot().canPrevious, true);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.nextPage();
    assert.equal(fetch.mock.calls.length, 2);
    await controller.previousPage();
    assert.equal(controller.getSnapshot().query.page, 1);
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, rows.slice(0, 20));
    controller.dispose();
  });
  it('publishes loading immediately, prevents overlapping focus reads and resolves a valid empty result', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([], url => url.pathname === '/api/ingredients' ? pending.promise : undefined);
    const controller = createIngredientListController(factory);
    const work = controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    pending.resolve(page([], new URL(`${baseUrl}/ingredients?page=1&limit=20`)));
    await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, []);
    assert.equal(controller.getSnapshot().canNext, false);
    controller.dispose();
  });
  for (const cause of ['not-found', 'server', 'network', 'malformed'] as const) {
    it(`preserves a safe ${cause} error until the user explicitly retries`, async () => {
      let failed = true;
      const { factory, fetch } = setup([activeIngredient], url => {
        if (!failed || url.pathname !== '/api/ingredients') return;
        if (cause === 'network') throw new Error('private network implementation detail');
        if (cause === 'malformed') return json({ data: [{ ...activeIngredient, costPrice: 1 }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
        return json({ error: 'private database error' }, cause === 'not-found' ? 404 : 500);
      });
      const controller = createIngredientListController(factory);
      await controller.focus();
      const state = controller.getSnapshot().snapshot;
      assert.equal(state.status, 'error');
      assert.equal(state.error?.code, cause === 'not-found' ? 'NOT_FOUND' : cause === 'server' ? 'SERVER_ERROR' : cause === 'network' ? 'NETWORK' : 'MALFORMED_RESPONSE');
      assert.ok(!state.error?.message.includes('private'));
      assert.equal(state.data, undefined);
      await controller.focus();
      assert.equal(fetch.mock.calls.length, 1);
      failed = false;
      await controller.retry();
      assert.equal(controller.getSnapshot().snapshot.status, 'success');
      assert.equal(fetch.mock.calls.length, 2);
      controller.dispose();
    });
  }
  it('retains a configuration error gracefully and permits an explicit retry after configuration is corrected', async () => {
    const { client, fetch } = setup();
    let configured = false;
    const factory = mock.fn(() => configured ? client : createCatalogClient({ baseUrl: '' }));
    const controller = createIngredientListController(factory);
    assert.equal(factory.mock.calls.length, 0);
    await controller.focus();
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'CONFIGURATION');
    assert.equal(fetch.mock.calls.length, 0);
    await controller.focus();
    assert.equal(factory.mock.calls.length, 1);
    configured = true;
    await controller.retry();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  it('does not replace applied records/query when a draft fails validation', async () => {
    const { factory, fetch } = setup();
    const controller = createIngredientListController(factory);
    await controller.focus();
    const before = controller.getSnapshot();
    controller.updateDraft({ category: 'Dairy\0' });
    await controller.apply();
    assert.ok(controller.getSnapshot().validationError);
    assert.deepEqual(controller.getSnapshot().query, before.query);
    assert.deepEqual(controller.getSnapshot().snapshot.data, before.snapshot.data);
    assert.equal(fetch.mock.calls.length, 1);
    controller.updateDraft({ category: 'Dairy' });
    assert.equal(controller.getSnapshot().validationError, undefined);
    await controller.apply();
    assert.equal(fetch.mock.calls.length, 2);
    controller.dispose();
  });
  it('permits Previous to recover from an error on a later page without discarding applied filters', async () => {
    const { factory, urls } = setup(records(21), url => url.searchParams.get('page') === '2' ? json({ error: 'Unavailable' }, 500) : undefined);
    const controller = createIngredientListController(factory);
    controller.updateDraft({ search: 'Ingredient', unit: 'ml' });
    await controller.apply();
    await controller.focus();
    await controller.nextPage();
    assert.equal(controller.getSnapshot().snapshot.status, 'error');
    assert.equal(controller.getSnapshot().canPrevious, true);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.previousPage();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(urls().at(-1)?.searchParams.get('page'), '1');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'Ingredient');
    assert.equal(urls().at(-1)?.searchParams.get('unit'), 'ml');
    controller.dispose();
  });
  for (const outcome of ['success', 'failure'] as const) {
    it(`ignores an older search ${outcome} after new applied filters clear the stale read`, async () => {
      const pending = deferred<Response>();
      const { factory } = setup([activeIngredient], url => url.searchParams.get('search') === 'old' ? pending.promise : undefined);
      const controller = createIngredientListController(factory);
      controller.updateDraft({ search: 'old' });
      await controller.apply();
      const old = controller.focus();
      controller.updateDraft({ search: 'new' });
      const current = controller.apply();
      assert.equal(controller.getSnapshot().snapshot.status, 'loading');
      assert.equal(controller.getSnapshot().snapshot.data, undefined);
      await current;
      if (outcome === 'success') pending.resolve(page([{ ...activeIngredient, name: 'Stale Ingredient' }], new URL(`${baseUrl}/ingredients?page=1&limit=20`)));
      else pending.reject(new Error('late private failure'));
      await old;
      assert.equal(controller.getSnapshot().query.search, 'new');
      assert.equal(controller.getSnapshot().snapshot.status, 'success');
      assert.equal(controller.getSnapshot().snapshot.data?.data[0].name, activeIngredient.name);
      assert.equal(controller.getSnapshot().snapshot.error, undefined);
      controller.dispose();
    });
  }
  it('cancels an in-flight list on blur and resumes the same applied page/filter only on focus', async () => {
    const pending = deferred<Response>();
    let first = true;
    const { factory, fetch, urls } = setup([activeIngredient], () => { if (first) { first = false; return pending.promise; } });
    const controller = createIngredientListController(factory);
    controller.updateDraft({ search: 'Milk' });
    await controller.apply();
    const work = controller.focus();
    controller.blur();
    await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    await controller.retry();
    assert.equal(fetch.mock.calls.length, 1);
    await controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(urls()[1].search, urls()[0].search);
    pending.resolve(page([], urls()[0]));
    controller.dispose();
  });
  it('retains settled success while navigating away/back without automatic refresh or filter loss', async () => {
    const { factory, fetch } = setup(records(25));
    const controller = createIngredientListController(factory);
    controller.updateDraft({ search: 'Ingredient', category: 'Dairy', sortBy: 'code', sortOrder: 'desc' });
    await controller.apply();
    await controller.focus();
    await controller.nextPage();
    const before = controller.getSnapshot();
    controller.blur();
    await controller.focus();
    assert.deepEqual(controller.getSnapshot(), before);
    assert.equal(fetch.mock.calls.length, 2);
    controller.dispose();
  });
  it('keeps a settled error on blur/focus and does not turn navigation into an automatic retry', async () => {
    const { factory, fetch } = setup([], () => json({ error: 'Unavailable' }, 500));
    const controller = createIngredientListController(factory);
    await controller.focus();
    controller.blur();
    await controller.retry();
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(controller.getSnapshot().snapshot.status, 'error');
    controller.dispose();
  });
  it('surfaces a read deadline without automatic retries and permits explicit GET recovery', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    let failed = true;
    const { factory, fetch } = setup([activeIngredient], () => failed ? pending.promise : undefined, 20);
    const controller = createIngredientListController(factory);
    const work = controller.focus();
    mock.timers.tick(21);
    await work;
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'TIMEOUT');
    assert.equal(fetch.mock.calls.length, 1);
    failed = false;
    await controller.retry();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(fetch.mock.calls.length, 2);
    pending.resolve(page([], new URL(`${baseUrl}/ingredients?page=1&limit=20`)));
    controller.dispose();
  });
  it('permanently stops reads and notifications after disposal, including a late response', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([], () => pending.promise);
    const controller = createIngredientListController(factory);
    let notifications = 0;
    controller.subscribe(() => { notifications++; });
    const work = controller.focus();
    controller.dispose();
    const count = notifications;
    pending.resolve(page([activeIngredient], new URL(`${baseUrl}/ingredients?page=1&limit=20`)));
    await work;
    await controller.focus(); await controller.retry(); await controller.reset(); await controller.nextPage();
    controller.updateDraft({ search: 'ignored' });
    assert.equal(notifications, count);
    assert.equal(fetch.mock.calls.length, 1);
  });
});

describe('Ingredient detail and retained list navigation state', () => {
  for (const value of [undefined, null, '507f1f77bcf86cd799439011', 'not-a-uuid', [ingredientId], [ingredientId, otherId]]) {
    it(`rejects invalid detail parameters ${JSON.stringify(value)} before constructing any API client`, async () => {
      const factory = mock.fn(() => { throw new Error('Invalid route must not read configuration'); });
      const controller = createIngredientDetailController(value, factory);
      assert.equal(controller.getSnapshot().invalidId, true);
      assert.equal(controller.getSnapshot().snapshot.status, 'idle');
      await controller.focus(); await controller.retry(); controller.blur(); await controller.focus();
      assert.equal(factory.mock.calls.length, 0);
      controller.dispose();
    });
  }
  it('loads a direct valid UUID link lazily and retains every raw detail field through presentation', async () => {
    const { factory, fetch, urls } = setup([ingredient]);
    const controller = createIngredientDetailController(ingredientId.toUpperCase(), factory);
    assert.equal(factory.mock.calls.length, 0);
    assert.equal(controller.getSnapshot().invalidId, false);
    assert.equal(controller.getSnapshot().id, ingredientId.toUpperCase());
    await controller.focus();
    assert.equal(urls()[0].pathname, `/api/ingredients/${ingredientId.toUpperCase()}`);
    const record = controller.getSnapshot().snapshot.data?.data;
    assert.deepEqual(record, ingredient);
    assert.ok(record);
    assert.equal(Object.fromEntries(ingredientDetailFields(record).map(field => [field.label, field.value]))['Cost price'], ingredient.costPrice);
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  for (const cause of ['not-found', 'malformed'] as const) {
    it(`handles detail ${cause} without treating an invalid response as missing navigation input`, async () => {
      let failed = true;
      const { factory, fetch } = setup([ingredient], url => failed && url.pathname.endsWith(ingredientId)
        ? cause === 'not-found' ? json({ error: 'private missing reference' }, 404) : json({ data: { ...ingredient, minStock: 1 } }) : undefined);
      const controller = createIngredientDetailController(ingredientId, factory);
      await controller.focus();
      assert.equal(controller.getSnapshot().invalidId, false);
      assert.equal(controller.getSnapshot().snapshot.error?.code, cause === 'not-found' ? 'NOT_FOUND' : 'MALFORMED_RESPONSE');
      assert.equal(controller.getSnapshot().snapshot.data, undefined);
      assert.ok(!controller.getSnapshot().snapshot.error?.message.includes('private'));
      await controller.focus();
      assert.equal(fetch.mock.calls.length, 1);
      failed = false;
      await controller.retry();
      assert.deepEqual(controller.getSnapshot().snapshot.data?.data, ingredient);
      assert.equal(fetch.mock.calls.length, 2);
      controller.dispose();
    });
  }
  it('handles missing public configuration without any fetch or an exception escaping focus', async () => {
    const controller = createIngredientDetailController(ingredientId);
    await assert.doesNotReject(controller.focus());
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'CONFIGURATION');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(forbiddenFetchCalls, 0);
    controller.dispose();
  });
  it('publishes detail loading, cancels it on blur and suppresses off-screen retry', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([ingredient], () => pending.promise);
    const controller = createIngredientDetailController(ingredientId, factory);
    const work = controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    controller.blur();
    await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    await controller.retry();
    assert.equal(fetch.mock.calls.length, 1);
    pending.resolve(json({ data: ingredient }));
    controller.dispose();
  });
  it('retains a detail timeout until explicit retry and recovers through GET only', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    let failed = true;
    const { factory, fetch } = setup([ingredient], () => failed ? pending.promise : undefined, 20);
    const controller = createIngredientDetailController(ingredientId, factory);
    const work = controller.focus();
    mock.timers.tick(21);
    await work;
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'TIMEOUT');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    failed = false;
    await controller.retry();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, ingredient);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET' && call.arguments[1]?.body === undefined));
    pending.resolve(json({ data: ingredient }));
    controller.dispose();
  });
  it('does not let a disposed detail response replace a newer direct-link selection', async () => {
    const pending = deferred<Response>();
    const { factory } = setup([ingredient, secondIngredient], url => url.pathname.endsWith(ingredientId) ? pending.promise : undefined);
    const old = createIngredientDetailController(ingredientId, factory);
    let notifications = 0;
    old.subscribe(() => { notifications++; });
    const work = old.focus();
    old.dispose();
    const count = notifications;
    const current = createIngredientDetailController(otherId, factory);
    await current.focus();
    pending.resolve(json({ data: { ...ingredient, name: 'Stale detail name' } }));
    await work;
    assert.equal(notifications, count);
    assert.equal(current.getSnapshot().id, otherId);
    assert.equal(current.getSnapshot().snapshot.data?.data.name, secondIngredient.name);
    current.dispose();
  });
  it('keeps the applied list filters, page and records independent of detail focus/retry and back navigation', async () => {
    const rows = records(25);
    const { factory, urls, fetch } = setup(rows);
    const list = createIngredientListController(factory);
    list.updateDraft({ search: 'Ingredient', category: 'Dairy', unit: 'ml', status: 'active', sortBy: 'minStock', sortOrder: 'desc' });
    await list.apply();
    await list.focus();
    await list.nextPage();
    const retained = list.getSnapshot();
    list.blur();
    const detail = createIngredientDetailController(rows[20]._id, factory);
    await detail.focus();
    await detail.retry();
    detail.dispose();
    await list.focus();
    assert.deepEqual(list.getSnapshot(), retained);
    assert.equal(fetch.mock.calls.length, 4);
    await list.retry();
    assert.equal(urls().at(-1)?.search, urls()[1].search);
    assert.equal(list.getSnapshot().query.page, 2);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET' && call.arguments[1]?.body === undefined));
    list.dispose();
  });
});
