import { CatalogApiError } from '../api/catalog.errors.ts';
import type { CatalogClient } from '../api/catalog.ts';
import type { Ingredient, Product, UUID } from '../api/catalog.types.ts';

export type RecipeReferenceClientFactory = () => Pick<CatalogClient, 'products' | 'ingredients'>;
export type RecipeReferenceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface RecipeReferenceEntry<T> {
  readonly status: RecipeReferenceStatus;
  readonly data?: T;
  readonly error?: CatalogApiError;
}

export interface RecipeReferenceSnapshot {
  readonly products: ReadonlyMap<UUID, RecipeReferenceEntry<Product>>;
  readonly ingredients: ReadonlyMap<UUID, RecipeReferenceEntry<Ingredient>>;
}

export function readRecipeReference<T>(entries: ReadonlyMap<UUID, RecipeReferenceEntry<T>>, id: UUID) {
  return entries.get(id) ?? [...entries].find(([key]) => key.toLowerCase() === id.toLowerCase())?.[1];
}

type Kind = 'products' | 'ingredients';
interface Job { readonly kind: Kind; readonly id: UUID; readonly revision: number }

function safeError(error: unknown) {
  return error instanceof CatalogApiError ? error : new CatalogApiError('NETWORK');
}

/** Deduplicated, bounded GET-only metadata reads scoped to one Recipe response revision. */
export function createRecipeReferences(factory: RecipeReferenceClientFactory, onChange: () => void, concurrency = 4) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new CatalogApiError('CONFIGURATION');
  let revision = 0;
  let active = false;
  let disposed = false;
  let running = 0;
  let queue: Job[] = [];
  const controllers = new Map<string, AbortController>();
  const products = new Map<UUID, RecipeReferenceEntry<Product>>();
  const ingredients = new Map<UUID, RecipeReferenceEntry<Ingredient>>();

  const key = (kind: Kind, id: UUID) => `${kind}:${id.toLowerCase()}`;
  const mapFor = (kind: Kind) => kind === 'products' ? products : ingredients;
  function snapshot(): RecipeReferenceSnapshot {
    return Object.freeze({ products: new Map(products), ingredients: new Map(ingredients) });
  }
  function emit() { if (!disposed) onChange(); }
  function abortRunning() {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  }
  function enqueueIdle() {
    const queued = new Set(queue.map(job => key(job.kind, job.id)));
    for (const [kind, map] of [['products', products], ['ingredients', ingredients]] as const) {
      for (const [id, entry] of map) {
        const jobKey = key(kind, id);
        if (entry.status === 'idle' && !queued.has(jobKey) && !controllers.has(jobKey)) {
          queue.push({ kind, id, revision });
          queued.add(jobKey);
        }
      }
    }
  }
  function pump() {
    if (!active || disposed) return;
    while (running < concurrency && queue.length) {
      const job = queue.shift()!;
      if (job.revision !== revision) continue;
      const map = mapFor(job.kind);
      if (map.get(job.id)?.status !== 'idle') continue;
      const controller = new AbortController();
      const jobKey = key(job.kind, job.id);
      controllers.set(jobKey, controller);
      map.set(job.id, Object.freeze({ status: 'loading' }));
      running++;
      emit();
      const work = async (): Promise<Product | Ingredient> => {
        const client = factory();
        return job.kind === 'products'
          ? (await client.products.detail(job.id, { signal: controller.signal })).data
          : (await client.ingredients.detail(job.id, { signal: controller.signal })).data;
      };
      void work().then(data => {
        if (!disposed && active && revision === job.revision && controllers.get(jobKey) === controller) {
          if (job.kind === 'products') products.set(job.id, Object.freeze({ status: 'success', data: data as Product }));
          else ingredients.set(job.id, Object.freeze({ status: 'success', data: data as Ingredient }));
        }
      }, error => {
        if (!disposed && active && revision === job.revision && controllers.get(jobKey) === controller
          && !controller.signal.aborted) {
          map.set(job.id, Object.freeze({ status: 'error', error: safeError(error) }));
        }
      }).finally(() => {
        running--;
        if (controllers.get(jobKey) === controller) controllers.delete(jobKey);
        if (!disposed) {
          if (revision === job.revision) emit();
          // An older cancelled revision may have occupied a concurrency slot.
          // Resume the current queue as soon as that slot is released.
          pump();
        }
      });
    }
  }
  function replace(productIds: readonly UUID[], ingredientIds: readonly UUID[] = []) {
    if (disposed) return;
    revision++;
    abortRunning();
    queue = [];
    products.clear(); ingredients.clear();
    for (const id of productIds) if (![...products.keys()].some(value => value.toLowerCase() === id.toLowerCase())) {
      products.set(id, Object.freeze({ status: 'idle' }));
    }
    for (const id of ingredientIds) if (![...ingredients.keys()].some(value => value.toLowerCase() === id.toLowerCase())) {
      ingredients.set(id, Object.freeze({ status: 'idle' }));
    }
    enqueueIdle(); emit(); pump();
  }
  function retry(kind: Kind, id: UUID) {
    if (disposed || !active) return;
    const map = mapFor(kind);
    const found = [...map.keys()].find(value => value.toLowerCase() === id.toLowerCase());
    if (!found || map.get(found)?.status !== 'error') return;
    // A failed request is not retained as a promise/cache entry; retry creates a fresh GET.
    map.set(found, Object.freeze({ status: 'idle' }));
    enqueueIdle(); emit(); pump();
  }
  return Object.freeze({
    getSnapshot: snapshot,
    replace,
    focus() { if (disposed) return; active = true; enqueueIdle(); emit(); pump(); },
    blur() {
      if (disposed) return;
      active = false; revision++; abortRunning(); queue = [];
      for (const [id, entry] of products) if (entry.status === 'loading') products.set(id, Object.freeze({ status: 'idle' }));
      for (const [id, entry] of ingredients) if (entry.status === 'loading') ingredients.set(id, Object.freeze({ status: 'idle' }));
      emit();
    },
    retryProduct(id: UUID) { retry('products', id); },
    retryIngredient(id: UUID) { retry('ingredients', id); },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; revision++; abortRunning(); queue = [];
      products.clear(); ingredients.clear();
    },
  });
}
