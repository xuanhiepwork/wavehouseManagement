import { createCatalogClient } from '../api/catalog.ts';
import type { CatalogClient } from '../api/catalog.ts';
import { createCatalogRead } from '../api/catalog.read.ts';
import type { CatalogReadSnapshot } from '../api/catalog.read.ts';
import type { DataEnvelope, Product, PageEnvelope } from '../api/catalog.types.ts';
import { readCatalogDetailId } from '../navigation/catalog.routes.ts';
import { DEFAULT_PRODUCT_DRAFT, productQuery } from './product.model.ts';
import type { ProductDraft, ProductListQuery } from './product.model.ts';

export type ProductClientFactory = () => Pick<CatalogClient, 'products'>;
const defaultFactory: ProductClientFactory = () => createCatalogClient();
export interface ProductListState {
  readonly draft: ProductDraft;
  readonly query: ProductListQuery;
  readonly snapshot: CatalogReadSnapshot<PageEnvelope<Product>>;
  readonly validationError?: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
}

/** Retains the applied list revision across detail navigation without a global singleton. */
export function createProductListController(factory: ProductClientFactory = defaultFactory) {
  const read = createCatalogRead<PageEnvelope<Product>>();
  const listeners = new Set<() => void>();
  let draft = DEFAULT_PRODUCT_DRAFT;
  let query = productQuery(draft);
  let validationError: string | undefined;
  let active = false, disposed = false;
  let state: ProductListState;
  function publish() {
    const snapshot = read.getSnapshot();
    state = Object.freeze({ draft, query, snapshot, validationError,
      canPrevious: query.page > 1 && snapshot.status !== 'loading',
      canNext: snapshot.status === 'success' && snapshot.data !== undefined
        && query.page < snapshot.data.pagination.totalPages && query.page * query.limit <= 2_147_483_647,
    });
    for (const listener of listeners) listener();
  }
  const unsubscribe = read.subscribe(publish);
  publish();
  function load() {
    if (disposed || !active) return Promise.resolve();
    const applied = query;
    return read.load(signal => factory().products.list(applied, { signal }));
  }
  function replace(next: ProductListQuery) {
    query = next; validationError = undefined;
    // Cancel clears data synchronously even when this controller is currently off-screen.
    read.cancel();
    return load();
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    focus() {
      if (disposed) return Promise.resolve();
      active = true;
      return read.getSnapshot().status === 'idle' ? load() : Promise.resolve();
    },
    blur() {
      active = false;
      if (!disposed && read.getSnapshot().status === 'loading') read.cancel();
    },
    updateDraft(patch: Partial<ProductDraft>) {
      if (disposed) return;
      draft = Object.freeze({ ...draft, ...patch }); validationError = undefined; publish();
    },
    apply() {
      if (disposed) return Promise.resolve();
      try { return replace(productQuery(draft)); }
      catch { validationError = 'Check the Product filter values. Search and category cannot contain a null character.'; publish(); return Promise.resolve(); }
    },
    reset() {
      if (disposed) return Promise.resolve();
      draft = DEFAULT_PRODUCT_DRAFT;
      return replace(productQuery(draft));
    },
    previousPage() {
      return !disposed && state.canPrevious ? replace(Object.freeze({ ...query, page: query.page - 1 })) : Promise.resolve();
    },
    nextPage() {
      return !disposed && state.canNext ? replace(Object.freeze({ ...query, page: query.page + 1 })) : Promise.resolve();
    },
    retry: load,
    dispose() {
      if (disposed) return;
      disposed = true; active = false; read.dispose(); unsubscribe(); listeners.clear();
    },
  });
}

export interface ProductDetailState {
  readonly id?: string;
  readonly invalidId: boolean;
  readonly snapshot: CatalogReadSnapshot<DataEnvelope<Product>>;
}
export function createProductDetailController(value: unknown, factory: ProductClientFactory = defaultFactory) {
  const id = readCatalogDetailId(value);
  const read = createCatalogRead<DataEnvelope<Product>>();
  const listeners = new Set<() => void>();
  let active = false, disposed = false;
  let state: ProductDetailState;
  function publish() {
    state = Object.freeze({ id, invalidId: id === undefined, snapshot: read.getSnapshot() });
    for (const listener of listeners) listener();
  }
  const unsubscribe = read.subscribe(publish);
  publish();
  function load() {
    return !disposed && active && id ? read.load(signal => factory().products.detail(id, { signal })) : Promise.resolve();
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    focus() {
      if (disposed) return Promise.resolve();
      active = true;
      return read.getSnapshot().status === 'idle' ? load() : Promise.resolve();
    },
    blur() {
      active = false;
      if (!disposed && read.getSnapshot().status === 'loading') read.cancel();
    },
    retry: load,
    dispose() {
      if (disposed) return;
      disposed = true; active = false; read.dispose(); unsubscribe(); listeners.clear();
    },
  });
}
