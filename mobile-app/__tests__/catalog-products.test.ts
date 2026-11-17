import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createCatalogClient } from '../src/api/catalog.ts';
import type { Product, ProductPrice } from '../src/api/catalog.types.ts';
import { createIngredientListController } from '../src/ingredients/ingredient.controller.ts';
import { createProductDetailController, createProductListController } from '../src/products/product.controller.ts';
import {
  DEFAULT_PRODUCT_DRAFT, orderedProductPrices, productDetailFields, productListFields, productQuery,
} from '../src/products/product.model.ts';
import type { ProductDraft } from '../src/products/product.model.ts';
import { ingredient, otherId, product, productId } from './fixtures/catalog.ts';

const baseUrl = 'http://127.0.0.1:5000/api';
const availableProduct: Product = { ...product, isAvailable: true };
const secondProduct: Product = { ...product, _id: otherId, code: 'COFFEE', name: 'Coffee', category: 'Coffee', prices: [{ size: 'M', price: '0.0001' }] };
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
  assert.equal(forbiddenFetchCalls, 0, 'Product tests must never reach live fetch');
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function page<T>(rows: readonly T[], url: URL) {
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
function setup(rows: readonly Product[] = [availableProduct], handler?: Handler, timeoutMs = 5_000) {
  const fetch = mock.fn<typeof globalThis.fetch>(async (input, initial) => {
    const init = initial ?? {};
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:5000');
    const override = handler?.(url, init);
    if (override !== undefined) return override;
    if (url.pathname === '/api/products') {
      const availability = url.searchParams.get('isAvailable');
      return page(rows.filter(row => availability === null || row.isAvailable === (availability === 'true')), url);
    }
    if (url.pathname === '/api/ingredients') return page([{ ...ingredient, isActive: true }], url);
    const record = rows.find(row => url.pathname.toLowerCase() === `/api/products/${row._id.toLowerCase()}`);
    return record ? json({ data: record }) : json({ error: 'Not found' }, 404);
  });
  const client = createCatalogClient({ baseUrl, fetch, timeoutMs });
  const factory = mock.fn(() => ({ products: client.products }));
  return { client, fetch, factory, urls: () => fetch.mock.calls.map(call => new URL(String(call.arguments[0]))) };
}
function records(count: number) {
  return Array.from({ length: count }, (_, index): Product => ({ ...availableProduct,
    _id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, code: `PRO${index + 1}`, name: `Product ${index + 1}` }));
}

describe('Product filters and exact size-price presentation', () => {
  it('omits All availability and optional blank text, without inventing Product sorting', () => {
    assert.deepEqual(productQuery(DEFAULT_PRODUCT_DRAFT), { page: 1, limit: 20 });
    const draft = { ...DEFAULT_PRODUCT_DRAFT, sortBy: 'name', sortOrder: 'desc' };
    assert.deepEqual(productQuery(draft), { page: 1, limit: 20 });
  });
  it('trims search and category while preserving category case and reserved characters', () => {
    assert.deepEqual(productQuery({ ...DEFAULT_PRODUCT_DRAFT, search: ' Tea & sữa +%_?# ', category: ' Cold Drinks ' }, 3), {
      page: 3, limit: 20, search: 'Tea & sữa +%_?#', category: 'Cold Drinks',
    });
  });
  for (const [availability, expected] of [['all', undefined], ['available', true], ['unavailable', false]] as const) {
    it(`maps ${availability} to the exact isAvailable filter`, () => {
      assert.equal(productQuery({ ...DEFAULT_PRODUCT_DRAFT, availability }).isAvailable, expected);
    });
  }
  for (const patch of [{ search: 'Tea\0' }, { category: '\0Drinks' }, { availability: 'active' }]) {
    it(`rejects invalid Product filters ${JSON.stringify(patch)}`, () => {
      assert.throws(() => productQuery({ ...DEFAULT_PRODUCT_DRAFT, ...patch } as ProductDraft), { code: 'BAD_REQUEST' });
    });
  }
  for (const current of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
    it(`rejects an invalid or unsafe Product page ${current}`, () => {
      assert.throws(() => productQuery(DEFAULT_PRODUCT_DRAFT, current), { code: 'BAD_REQUEST' });
    });
  }
  const supportedPrices: readonly (readonly ProductPrice[])[] = [
    [{ size: 'M', price: '0.0001' }],
    [{ size: 'L', price: '99999999999999.9999' }, { size: 'S', price: '0' }],
    product.prices,
  ];
  for (const prices of supportedPrices) {
    it(`shows only the ${prices.length} supported sizes in S/M/L order with exact prices`, () => {
      const value: Product = { ...product, prices };
      const expected = [...prices].sort((a, b) => ['S', 'M', 'L'].indexOf(a.size) - ['S', 'M', 'L'].indexOf(b.size));
      assert.deepEqual(orderedProductPrices(value), expected);
      const fields = productListFields(value).filter(field => field.label.startsWith('Price'));
      assert.deepEqual(fields, expected.map(entry => ({ label: `Price (${entry.size})`, value: entry.price })));
      assert.ok(fields.every(field => typeof field.value === 'string'));
      if (!prices.some(entry => entry.size === 'M')) assert.equal(fields.some(field => field.label === 'Price (M)'), false);
    });
  }
  it('sorts a new price array without mutating the backend array or converting its string values', () => {
    const source: Product = Object.freeze({ ...product, prices: Object.freeze([...product.prices]) });
    const before = [...source.prices];
    const ordered = orderedProductPrices(source);
    assert.notEqual(ordered, source.prices);
    assert.deepEqual(source.prices, before);
    assert.deepEqual(ordered.map(entry => entry.size), ['S', 'M', 'L']);
    assert.deepEqual(ordered.map(entry => entry.price), ['0', '0.0001', '99999999999999.9999']);
  });
  for (const isAvailable of [true, false]) {
    it(`presents the complete list and detail fields for an ${isAvailable ? 'available' : 'unavailable'} Product`, () => {
      const value = { ...product, isAvailable, name: 'Trà '.repeat(35), code: 'LONG-CODE-'.repeat(15) };
      const list = Object.fromEntries(productListFields(value).map(field => [field.label, field.value]));
      assert.deepEqual(list, { Name: value.name, Code: value.code, Category: value.category,
        Availability: isAvailable ? 'Available' : 'Unavailable', 'Price (S)': '0', 'Price (M)': '0.0001', 'Price (L)': '99999999999999.9999' });
      assert.deepEqual(Object.fromEntries(productDetailFields(value).map(field => [field.label, field.value])), {
        UUID: value._id, ...list, Created: value.createdAt, Updated: value.updatedAt,
      });
      assert.deepEqual(value.prices, product.prices);
    });
  }
});

describe('Product list with the real mocked GET-only client', () => {
  it('constructs lazily and loads All Products with only the default page and limit', async () => {
    const { factory, fetch, urls } = setup([secondProduct, availableProduct]);
    const controller = createProductListController(factory);
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(factory.mock.calls.length, 0);
    await controller.retry();
    assert.equal(fetch.mock.calls.length, 0);
    await controller.focus();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, [secondProduct, availableProduct]);
    assert.deepEqual(Object.fromEntries(urls()[0].searchParams), { page: '1', limit: '20' });
    assert.equal(urls()[0].pathname, '/api/products');
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  for (const availability of ['available', 'unavailable'] as const) {
    it(`preserves explicit ${availability} selection through the real request`, async () => {
      const { factory, urls } = setup([availableProduct, secondProduct]);
      const controller = createProductListController(factory);
      controller.updateDraft({ availability });
      await controller.apply();
      await controller.focus();
      assert.equal(urls()[0].searchParams.get('isAvailable'), String(availability === 'available'));
      assert.deepEqual(controller.getSnapshot().snapshot.data?.data, availability === 'available' ? [availableProduct] : [secondProduct]);
      controller.dispose();
    });
  }
  it('keeps draft search/category separate until Apply resets page one and synchronously clears old data', async () => {
    const { factory, fetch, urls } = setup(records(25));
    const controller = createProductListController(factory);
    await controller.focus();
    await controller.nextPage();
    controller.updateDraft({ search: ' tea & milk ', category: ' Cold Drinks ', availability: 'unavailable' });
    assert.equal(controller.getSnapshot().query.page, 2);
    assert.equal(controller.getSnapshot().query.search, undefined);
    assert.equal(fetch.mock.calls.length, 2);
    const work = controller.apply();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(controller.getSnapshot().query.page, 1);
    await work;
    assert.deepEqual(Object.fromEntries(urls().at(-1)!.searchParams), {
      page: '1', limit: '20', search: 'tea & milk', category: 'Cold Drinks', isAvailable: 'false',
    });
    controller.dispose();
  });
  it('keeps unapplied edits out of Next and Previous requests without adding sorting', async () => {
    const { factory, urls } = setup(records(41));
    const controller = createProductListController(factory);
    controller.updateDraft({ search: 'applied', category: 'Drinks', availability: 'available' });
    await controller.apply();
    await controller.focus();
    await controller.nextPage();
    controller.updateDraft({ search: 'pending', category: 'Pending', availability: 'unavailable' });
    await controller.nextPage();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '3');
    await controller.previousPage();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '2');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'applied');
    assert.equal(urls().at(-1)?.searchParams.get('category'), 'Drinks');
    assert.equal(urls().at(-1)?.searchParams.get('isAvailable'), 'true');
    assert.equal(controller.getSnapshot().draft.search, 'pending');
    assert.ok(urls().every(url => !url.searchParams.has('sortBy') && !url.searchParams.has('sortOrder')));
    await controller.apply();
    assert.equal(urls().at(-1)?.searchParams.get('page'), '1');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'pending');
    controller.dispose();
  });
  it('applies filters off-screen without creating the API client until focus', async () => {
    const { factory, fetch, urls } = setup();
    const controller = createProductListController(factory);
    controller.updateDraft({ search: 'Tea', category: 'Drinks' });
    await controller.apply();
    assert.equal(factory.mock.calls.length, 0);
    assert.equal(fetch.mock.calls.length, 0);
    await controller.focus();
    assert.equal(urls()[0].searchParams.get('search'), 'Tea');
    assert.equal(urls()[0].searchParams.get('category'), 'Drinks');
    controller.dispose();
  });
  it('resets filters and page with All availability and a fresh GET', async () => {
    const { factory, fetch, urls } = setup(records(25));
    const controller = createProductListController(factory);
    await controller.focus();
    await controller.nextPage();
    controller.updateDraft({ search: 'Tea', category: 'Drinks', availability: 'unavailable' });
    await controller.apply();
    const work = controller.reset();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    await work;
    assert.deepEqual(controller.getSnapshot().draft, DEFAULT_PRODUCT_DRAFT);
    assert.deepEqual(controller.getSnapshot().query, { page: 1, limit: 20 });
    assert.equal(urls().at(-1)?.searchParams.has('isAvailable'), false);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET' && call.arguments[1]?.body === undefined));
    controller.dispose();
  });
  it('preserves backend record/price ordering while paging and disables reads beyond the reported boundaries', async () => {
    const rows = records(21).reverse();
    const { factory, fetch } = setup(rows);
    const controller = createProductListController(factory);
    await controller.focus();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, rows.slice(0, 20));
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data[0].prices, product.prices);
    assert.equal(controller.getSnapshot().canPrevious, false);
    assert.equal(controller.getSnapshot().canNext, true);
    await controller.previousPage();
    assert.equal(fetch.mock.calls.length, 1);
    await controller.nextPage();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, [rows[20]]);
    assert.equal(controller.getSnapshot().canPrevious, true);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.nextPage();
    assert.equal(fetch.mock.calls.length, 2);
    await controller.previousPage();
    assert.equal(controller.getSnapshot().query.page, 1);
    controller.dispose();
  });
  it('publishes loading immediately, prevents duplicate focus reads and settles an empty list', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([], () => pending.promise);
    const controller = createProductListController(factory);
    const work = controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    pending.resolve(page([], new URL(`${baseUrl}/products?page=1&limit=20`)));
    await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, []);
    assert.equal(controller.getSnapshot().canNext, false);
    controller.dispose();
  });
  for (const cause of ['not-found', 'server', 'network', 'malformed'] as const) {
    it(`keeps a safe ${cause} error until explicit retry without an automatic GET`, async () => {
      let failed = true;
      const { factory, fetch } = setup([availableProduct], url => {
        if (!failed || url.pathname !== '/api/products') return;
        if (cause === 'network') throw new Error('private transport detail');
        if (cause === 'malformed') return json({ data: [{ ...availableProduct, prices: [] }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
        return json({ error: 'private database detail' }, cause === 'not-found' ? 404 : 500);
      });
      const controller = createProductListController(factory);
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
  it('handles invalid public configuration lazily and recovers only through an explicit retry', async () => {
    const { client, fetch } = setup();
    let configured = false;
    const factory = mock.fn(() => configured ? client : createCatalogClient({ baseUrl: '' }));
    const controller = createProductListController(factory);
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
  it('retains applied query/records when a draft is invalid and clears its validation message on correction', async () => {
    const { factory, fetch } = setup();
    const controller = createProductListController(factory);
    await controller.focus();
    const before = controller.getSnapshot();
    controller.updateDraft({ category: 'Drinks\0' });
    await controller.apply();
    assert.ok(controller.getSnapshot().validationError);
    assert.deepEqual(controller.getSnapshot().query, before.query);
    assert.deepEqual(controller.getSnapshot().snapshot.data, before.snapshot.data);
    assert.equal(fetch.mock.calls.length, 1);
    controller.updateDraft({ category: 'Drinks' });
    assert.equal(controller.getSnapshot().validationError, undefined);
    await controller.apply();
    assert.equal(fetch.mock.calls.length, 2);
    controller.dispose();
  });
  it('allows Previous after a later-page failure while preserving applied Product filters', async () => {
    const { factory, urls } = setup(records(21), url => url.searchParams.get('page') === '2' ? json({ error: 'Unavailable' }, 500) : undefined);
    const controller = createProductListController(factory);
    controller.updateDraft({ search: 'Product', category: 'Drinks' });
    await controller.apply();
    await controller.focus();
    await controller.nextPage();
    assert.equal(controller.getSnapshot().snapshot.status, 'error');
    assert.equal(controller.getSnapshot().canPrevious, true);
    assert.equal(controller.getSnapshot().canNext, false);
    await controller.previousPage();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(urls().at(-1)?.searchParams.get('page'), '1');
    assert.equal(urls().at(-1)?.searchParams.get('search'), 'Product');
    assert.equal(urls().at(-1)?.searchParams.get('category'), 'Drinks');
    controller.dispose();
  });
  for (const outcome of ['success', 'failure'] as const) {
    it(`ignores a stale Product search ${outcome} after newer filters are applied`, async () => {
      const pending = deferred<Response>();
      const { factory } = setup([availableProduct], url => url.searchParams.get('search') === 'old' ? pending.promise : undefined);
      const controller = createProductListController(factory);
      controller.updateDraft({ search: 'old' });
      await controller.apply();
      const old = controller.focus();
      controller.updateDraft({ search: 'new' });
      const current = controller.apply();
      assert.equal(controller.getSnapshot().snapshot.status, 'loading');
      assert.equal(controller.getSnapshot().snapshot.data, undefined);
      await current;
      if (outcome === 'success') pending.resolve(page([{ ...availableProduct, name: 'Stale Product' }], new URL(`${baseUrl}/products?page=1&limit=20`)));
      else pending.reject(new Error('late private failure'));
      await old;
      assert.equal(controller.getSnapshot().query.search, 'new');
      assert.equal(controller.getSnapshot().snapshot.data?.data[0].name, availableProduct.name);
      assert.equal(controller.getSnapshot().snapshot.error, undefined);
      controller.dispose();
    });
  }
  it('aborts a pending read on blur and resumes the same query on focus without off-screen retries', async () => {
    const pending = deferred<Response>();
    let first = true;
    const { factory, fetch, urls } = setup([availableProduct], () => { if (first) { first = false; return pending.promise; } });
    const controller = createProductListController(factory);
    controller.updateDraft({ search: 'Tea', availability: 'available' });
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
  it('keeps settled success and applied page/filters across blur and focus without a new request', async () => {
    const { factory, fetch } = setup(records(25));
    const controller = createProductListController(factory);
    controller.updateDraft({ search: 'Product', category: 'Drinks', availability: 'available' });
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
  it('keeps settled errors across navigation instead of automatically retrying them', async () => {
    const { factory, fetch } = setup([], () => json({ error: 'Unavailable' }, 500));
    const controller = createProductListController(factory);
    await controller.focus();
    controller.blur();
    await controller.retry();
    await controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'error');
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  it('surfaces a list timeout without automatic retries and recovers by explicit GET', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    let failed = true;
    const { factory, fetch } = setup([availableProduct], () => failed ? pending.promise : undefined, 20);
    const controller = createProductListController(factory);
    const work = controller.focus();
    mock.timers.tick(21);
    await work;
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'TIMEOUT');
    assert.equal(fetch.mock.calls.length, 1);
    failed = false;
    await controller.retry();
    assert.equal(controller.getSnapshot().snapshot.status, 'success');
    assert.equal(fetch.mock.calls.length, 2);
    pending.resolve(page([], new URL(`${baseUrl}/products?page=1&limit=20`)));
    controller.dispose();
  });
  it('prevents reads and notifications permanently after disposal, including late results', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([], () => pending.promise);
    const controller = createProductListController(factory);
    let notifications = 0;
    controller.subscribe(() => { notifications++; });
    const work = controller.focus();
    controller.dispose();
    const count = notifications;
    pending.resolve(page([availableProduct], new URL(`${baseUrl}/products?page=1&limit=20`)));
    await work;
    await controller.focus(); await controller.retry(); await controller.reset(); await controller.nextPage();
    controller.updateDraft({ search: 'ignored' });
    assert.equal(notifications, count);
    assert.equal(fetch.mock.calls.length, 1);
  });
});

describe('Product detail and independent retained navigation state', () => {
  for (const value of [undefined, null, '507f1f77bcf86cd799439011', 'not-a-uuid', [productId], [productId, otherId]]) {
    it(`rejects invalid Product detail parameters ${JSON.stringify(value)} before any client is created`, async () => {
      const factory = mock.fn(() => { throw new Error('Invalid route must not read configuration'); });
      const controller = createProductDetailController(value, factory);
      assert.equal(controller.getSnapshot().invalidId, true);
      assert.equal(controller.getSnapshot().snapshot.status, 'idle');
      await controller.focus(); await controller.retry(); controller.blur(); await controller.focus();
      assert.equal(factory.mock.calls.length, 0);
      controller.dispose();
    });
  }
  it('loads unavailable Products from direct UUID links with exact raw prices and metadata', async () => {
    const { factory, fetch, urls } = setup([product]);
    const controller = createProductDetailController(productId.toUpperCase(), factory);
    assert.equal(factory.mock.calls.length, 0);
    assert.equal(controller.getSnapshot().id, productId.toUpperCase());
    await controller.focus();
    assert.equal(urls()[0].pathname, `/api/products/${productId.toUpperCase()}`);
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, product);
    const fields = Object.fromEntries(productDetailFields(controller.getSnapshot().snapshot.data!.data).map(field => [field.label, field.value]));
    assert.equal(fields.UUID, productId);
    assert.equal(fields.Availability, 'Unavailable');
    assert.equal(fields['Price (L)'], '99999999999999.9999');
    assert.equal(fields.Created, product.createdAt);
    assert.equal(fields.Updated, product.updatedAt);
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    controller.dispose();
  });
  for (const cause of ['not-found', 'malformed'] as const) {
    it(`retains a safe Product detail ${cause} error until explicit GET retry`, async () => {
      let failed = true;
      const { factory, fetch } = setup([product], url => failed && url.pathname.endsWith(productId)
        ? cause === 'not-found' ? json({ error: 'private missing record' }, 404) : json({ data: { ...product, prices: [{ size: 'S', price: 1 }] } }) : undefined);
      const controller = createProductDetailController(productId, factory);
      await controller.focus();
      assert.equal(controller.getSnapshot().invalidId, false);
      assert.equal(controller.getSnapshot().snapshot.error?.code, cause === 'not-found' ? 'NOT_FOUND' : 'MALFORMED_RESPONSE');
      assert.equal(controller.getSnapshot().snapshot.data, undefined);
      assert.ok(!controller.getSnapshot().snapshot.error?.message.includes('private'));
      await controller.focus();
      assert.equal(fetch.mock.calls.length, 1);
      failed = false;
      await controller.retry();
      assert.deepEqual(controller.getSnapshot().snapshot.data?.data, product);
      assert.equal(fetch.mock.calls.length, 2);
      controller.dispose();
    });
  }
  it('handles missing public configuration without a fetch or an exception escaping focus', async () => {
    const controller = createProductDetailController(productId);
    await assert.doesNotReject(controller.focus());
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'CONFIGURATION');
    assert.equal(controller.getSnapshot().snapshot.data, undefined);
    assert.equal(forbiddenFetchCalls, 0);
    controller.dispose();
  });
  it('publishes detail loading and aborts pending work on blur without retrying off-screen', async () => {
    const pending = deferred<Response>();
    const { factory, fetch } = setup([product], () => pending.promise);
    const controller = createProductDetailController(productId, factory);
    const work = controller.focus();
    assert.equal(controller.getSnapshot().snapshot.status, 'loading');
    controller.blur();
    await work;
    assert.equal(controller.getSnapshot().snapshot.status, 'idle');
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true);
    await controller.retry();
    assert.equal(fetch.mock.calls.length, 1);
    pending.resolve(json({ data: product }));
    controller.dispose();
  });
  it('retains a detail timeout until explicit GET retry succeeds', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>();
    let failed = true;
    const { factory, fetch } = setup([product], () => failed ? pending.promise : undefined, 20);
    const controller = createProductDetailController(productId, factory);
    const work = controller.focus();
    mock.timers.tick(21);
    await work;
    assert.equal(controller.getSnapshot().snapshot.error?.code, 'TIMEOUT');
    await controller.focus();
    assert.equal(fetch.mock.calls.length, 1);
    failed = false;
    await controller.retry();
    assert.deepEqual(controller.getSnapshot().snapshot.data?.data, product);
    pending.resolve(json({ data: product }));
    controller.dispose();
  });
  for (const outcome of ['success', 'failure'] as const) {
    it(`ignores disposed Product detail ${outcome} after a newer UUID selection`, async () => {
      const pending = deferred<Response>();
      const { factory } = setup([product, secondProduct], url => url.pathname.endsWith(productId) ? pending.promise : undefined);
      const old = createProductDetailController(productId, factory);
      let notifications = 0;
      old.subscribe(() => { notifications++; });
      const work = old.focus();
      old.dispose();
      const count = notifications;
      const current = createProductDetailController(otherId, factory);
      await current.focus();
      if (outcome === 'success') pending.resolve(json({ data: { ...product, name: 'Stale Product' } }));
      else pending.reject(new Error('late private detail failure'));
      await work;
      assert.equal(notifications, count);
      assert.equal(current.getSnapshot().id, otherId);
      assert.equal(current.getSnapshot().snapshot.data?.data.name, secondProduct.name);
      current.dispose();
    });
  }
  it('retains Product filters/page/settled data across separate detail focus and back-navigation lifecycle', async () => {
    const rows = records(25);
    const { factory, urls, fetch } = setup(rows);
    const list = createProductListController(factory);
    list.updateDraft({ search: 'Product', category: 'Drinks', availability: 'available' });
    await list.apply();
    await list.focus();
    await list.nextPage();
    const before = list.getSnapshot();
    list.blur();
    const detail = createProductDetailController(rows[20]._id, factory);
    await detail.focus();
    await detail.retry();
    detail.dispose();
    await list.focus();
    assert.deepEqual(list.getSnapshot(), before);
    assert.equal(fetch.mock.calls.length, 4);
    await list.retry();
    assert.equal(urls().at(-1)?.search, urls()[1].search);
    assert.equal(list.getSnapshot().query.page, 2);
    assert.ok(fetch.mock.calls.every(call => call.arguments[1]?.method === 'GET' && call.arguments[1]?.body === undefined));
    list.dispose();
  });
  it('keeps Product applied state independent of Ingredient filters, reads, reset and disposal', async () => {
    const { client, factory } = setup(records(25));
    const products = createProductListController(factory);
    products.updateDraft({ search: 'Product', category: 'Drinks', availability: 'available' });
    await products.apply();
    await products.focus();
    await products.nextPage();
    const before = products.getSnapshot();
    const ingredients = createIngredientListController(() => ({ ingredients: client.ingredients }));
    ingredients.updateDraft({ search: 'Milk', category: 'Dairy', status: 'active', unit: 'ml', sortBy: 'costPrice', sortOrder: 'desc' });
    await ingredients.apply();
    await ingredients.focus();
    await ingredients.reset();
    ingredients.dispose();
    assert.deepEqual(products.getSnapshot(), before);
    products.dispose();
  });
});
