import { createCatalogClient } from '../api/catalog.ts';
import type { CatalogClient } from '../api/catalog.ts';
import { createCatalogRead } from '../api/catalog.read.ts';
import type { CatalogReadSnapshot } from '../api/catalog.read.ts';
import type { DataEnvelope, PageEnvelope, Recipe } from '../api/catalog.types.ts';
import { readCatalogDetailId } from '../navigation/catalog.routes.ts';
import { DEFAULT_RECIPE_DRAFT, recipeQuery } from './recipe.model.ts';
import type { RecipeDraft, RecipeListQuery } from './recipe.model.ts';
import { createRecipeReferences } from './recipe.references.ts';
import type { RecipeReferenceSnapshot } from './recipe.references.ts';

export type RecipeClientFactory = () => Pick<CatalogClient, 'recipes' | 'products' | 'ingredients'>;
const defaultFactory: RecipeClientFactory = () => createCatalogClient();

export interface RecipeListState {
  readonly draft: RecipeDraft;
  readonly query: RecipeListQuery;
  readonly snapshot: CatalogReadSnapshot<PageEnvelope<Recipe>>;
  readonly references: RecipeReferenceSnapshot;
  readonly validationError?: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
}

export function createRecipeListController(factory: RecipeClientFactory = defaultFactory) {
  const read = createCatalogRead<PageEnvelope<Recipe>>();
  const listeners = new Set<() => void>();
  let draft = DEFAULT_RECIPE_DRAFT;
  let query = recipeQuery(draft);
  let validationError: string | undefined;
  let active = false, disposed = false, publishing = false;
  let bound: PageEnvelope<Recipe> | undefined;
  let state: RecipeListState;
  const references = createRecipeReferences(factory, publish);
  function publish() {
    if (publishing || disposed) return;
    publishing = true;
    const snapshot = read.getSnapshot();
    if (snapshot.status === 'success' && snapshot.data && snapshot.data !== bound) {
      bound = snapshot.data;
      references.replace(snapshot.data.data.map(record => record.productId));
    } else if (snapshot.status !== 'success' && bound !== undefined) {
      bound = undefined; references.replace([]);
    }
    state = Object.freeze({ draft, query, snapshot, references: references.getSnapshot(), validationError,
      canPrevious: query.page > 1 && snapshot.status !== 'loading',
      canNext: snapshot.status === 'success' && snapshot.data !== undefined
        && query.page < snapshot.data.pagination.totalPages && query.page * query.limit <= 2_147_483_647,
    });
    publishing = false;
    for (const listener of listeners) listener();
  }
  const unsubscribe = read.subscribe(publish);
  publish();
  function load() {
    if (disposed || !active) return Promise.resolve();
    const applied = query;
    return read.load(signal => factory().recipes.list(applied, { signal }));
  }
  function replace(next: RecipeListQuery) {
    query = next; validationError = undefined;
    // The read transition publishes idle synchronously; publish() clears the
    // bound reference revision before a replacement GET can begin.
    read.cancel();
    return load();
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    focus() {
      if (disposed) return Promise.resolve();
      active = true; references.focus();
      return read.getSnapshot().status === 'idle' ? load() : Promise.resolve();
    },
    blur() { active = false; references.blur(); if (!disposed && read.getSnapshot().status === 'loading') read.cancel(); },
    updateDraft(patch: Partial<RecipeDraft>) {
      if (disposed) return;
      draft = Object.freeze({ ...draft, ...patch }); validationError = undefined; publish();
    },
    apply() {
      if (disposed) return Promise.resolve();
      try { return replace(recipeQuery(draft)); }
      catch { validationError = 'Enter a single valid Product UUID before applying Recipe filters.'; publish(); return Promise.resolve(); }
    },
    reset() { if (disposed) return Promise.resolve(); draft = DEFAULT_RECIPE_DRAFT; return replace(recipeQuery(draft)); },
    previousPage() { return !disposed && state.canPrevious ? replace(Object.freeze({ ...query, page: query.page - 1 })) : Promise.resolve(); },
    nextPage() { return !disposed && state.canNext ? replace(Object.freeze({ ...query, page: query.page + 1 })) : Promise.resolve(); },
    retry: load,
    retryProduct: references.retryProduct,
    dispose() {
      if (disposed) return;
      disposed = true; active = false; references.dispose(); read.dispose(); unsubscribe(); listeners.clear();
    },
  });
}

export interface RecipeDetailState {
  readonly id?: string;
  readonly invalidId: boolean;
  readonly snapshot: CatalogReadSnapshot<DataEnvelope<Recipe>>;
  readonly references: RecipeReferenceSnapshot;
}

export function createRecipeDetailController(value: unknown, factory: RecipeClientFactory = defaultFactory) {
  const id = readCatalogDetailId(value);
  const read = createCatalogRead<DataEnvelope<Recipe>>();
  const listeners = new Set<() => void>();
  let active = false, disposed = false, publishing = false;
  let bound: DataEnvelope<Recipe> | undefined;
  let state: RecipeDetailState;
  const references = createRecipeReferences(factory, publish);
  function publish() {
    if (publishing || disposed) return;
    publishing = true;
    const snapshot = read.getSnapshot();
    if (snapshot.status === 'success' && snapshot.data && snapshot.data !== bound) {
      bound = snapshot.data;
      references.replace([snapshot.data.data.productId], snapshot.data.data.ingredients.map(item => item.ingredientId));
    } else if (snapshot.status !== 'success' && bound !== undefined) {
      bound = undefined; references.replace([]);
    }
    state = Object.freeze({ id, invalidId: id === undefined, snapshot, references: references.getSnapshot() });
    publishing = false;
    for (const listener of listeners) listener();
  }
  const unsubscribe = read.subscribe(publish);
  publish();
  function load() { return !disposed && active && id ? read.load(signal => factory().recipes.detail(id, { signal })) : Promise.resolve(); }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    focus() {
      if (disposed) return Promise.resolve();
      active = true; references.focus();
      return read.getSnapshot().status === 'idle' ? load() : Promise.resolve();
    },
    blur() { active = false; references.blur(); if (!disposed && read.getSnapshot().status === 'loading') read.cancel(); },
    retry: load,
    retryProduct: references.retryProduct,
    retryIngredient: references.retryIngredient,
    dispose() {
      if (disposed) return;
      disposed = true; active = false; references.dispose(); read.dispose(); unsubscribe(); listeners.clear();
    },
  });
}
