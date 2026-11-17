import { CatalogApiError } from './catalog.errors.ts';

export interface CatalogReadSnapshot<T> {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly data?: T;
  readonly error?: CatalogApiError;
}
export type CatalogReadLoader<T> = (signal: AbortSignal) => Promise<T>;

/** Explicit, framework-independent read state for a future native hook. Never starts work on import. */
export function createCatalogRead<T>() {
  let snapshot: CatalogReadSnapshot<T> = Object.freeze({ status: 'idle' });
  let generation = 0, disposed = false;
  let controller: AbortController | undefined;
  let lastLoader: CatalogReadLoader<T> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: CatalogReadSnapshot<T>) {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  async function load(loader: CatalogReadLoader<T>): Promise<void> {
    if (disposed) return;
    const token = ++generation;
    controller?.abort();
    const active = new AbortController();
    controller = active; lastLoader = loader;
    publish({ status: 'loading' });
    // A subscriber may replace or dispose this read while receiving loading.
    if (disposed || token !== generation) return;
    try {
      const data = await loader(active.signal);
      if (!disposed && token === generation) publish({ status: 'success', data });
    } catch (error) {
      if (!disposed && token === generation) publish({ status: 'error',
        error: error instanceof CatalogApiError ? error : new CatalogApiError('NETWORK') });
    } finally {
      if (token === generation) controller = undefined;
    }
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    retry: () => !disposed && lastLoader ? load(lastLoader) : Promise.resolve(),
    cancel() {
      if (disposed) return;
      generation++; controller?.abort(); controller = undefined;
      publish({ status: 'idle' });
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; controller?.abort(); controller = undefined;
      lastLoader = undefined; listeners.clear(); snapshot = Object.freeze({ status: 'idle' });
    },
  });
}
