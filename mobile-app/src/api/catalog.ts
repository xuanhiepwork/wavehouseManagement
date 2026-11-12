import { getCatalogBaseUrl } from '../config/catalog.ts';
import { CatalogApiError, httpError } from './catalog.errors.ts';
import type { DataEnvelope, Ingredient, IngredientQuery, PageEnvelope, Product, ProductQuery, Recipe, RecipeQuery, UUID } from './catalog.types.ts';
import { ingredientGuard, isDataEnvelope, isPageEnvelope, isUuid, productGuard, recipeGuard } from './catalog.validation.ts';
import type { Guard } from './catalog.validation.ts';

export { CatalogApiError } from './catalog.errors.ts';
export type { CatalogErrorCode } from './catalog.errors.ts';
export type * from './catalog.types.ts';

export interface CatalogClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
export interface CatalogReadOptions { readonly signal?: AbortSignal }
type Resource = 'ingredients' | 'products' | 'recipes';
const fields: Readonly<Record<Resource, readonly string[]>> = {
  ingredients: ['page', 'limit', 'category', 'unit', 'isActive', 'search', 'sortBy', 'sortOrder'],
  products: ['page', 'limit', 'search', 'category', 'isAvailable'],
  recipes: ['page', 'limit', 'productId', 'size', 'isActive'],
};
const sortFields = ['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function invalid(): never { throw new CatalogApiError('BAD_REQUEST'); }

function queryString(resource: Resource, query: unknown) {
  if (!object(query)) return invalid();
  const params = new URLSearchParams();
  const values: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (!fields[resource].includes(key)) return invalid();
    if (raw === undefined) continue;
    let value: string | number | boolean;
    if (key === 'page' || key === 'limit') {
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || (key === 'limit' && raw > 100)) return invalid();
      value = raw;
    } else if (key === 'isActive' || key === 'isAvailable') {
      if (typeof raw !== 'boolean') return invalid();
      value = raw;
    } else {
      if (typeof raw !== 'string') return invalid();
      if (key === 'search' || key === 'category') {
        if (!raw.trim() || raw.includes('\0')) return invalid();
        value = raw.trim();
      } else {
        if ((key === 'productId' && !isUuid(raw)) || (key === 'unit' && !['g', 'ml', 'piece'].includes(raw))
          || (key === 'size' && !['S', 'M', 'L'].includes(raw)) || (key === 'sortBy' && !sortFields.includes(raw))
          || (key === 'sortOrder' && !['asc', 'desc'].includes(raw))) return invalid();
        value = raw;
      }
    }
    values[key] = value;
    params.set(key, String(value));
  }
  const page = (values.page ?? 1) as number, limit = (values.limit ?? 20) as number;
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset) || offset > 2_147_483_647) return invalid();
  const encoded = params.toString();
  return { suffix: encoded ? `?${encoded}` : '', values };
}
function readSignal(options: CatalogReadOptions): AbortSignal | undefined {
  if (!object(options) || Object.keys(options).some(key => key !== 'signal')) return invalid();
  const signal = (options as CatalogReadOptions).signal;
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) return invalid();
  return signal;
}
function idPath(id: UUID) {
  if (!isUuid(id)) return invalid();
  return encodeURIComponent(id);
}
function validResponseUrl(response: Response, requested: string) {
  if (response.redirected === true) return false;
  if (!response.url) return true; // Native implementations and test transports may omit URL metadata.
  try { return new URL(response.url).href === new URL(requested).href; } catch { return false; }
}

/** Construction is lazy and explicit. The only public resource operations are the six GET reads. */
export function createCatalogClient(options: CatalogClientOptions = {}) {
  const base = getCatalogBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647 || typeof fetcher !== 'function') {
    throw new CatalogApiError('CONFIGURATION');
  }

  async function request<T>(path: string, validate: Guard<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new CatalogApiError('CANCELLED');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => { reject(new CatalogApiError('CANCELLED')); controller.abort(); };
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { reject(new CatalogApiError('TIMEOUT')); controller.abort(); }, timeoutMs);
    });
    const url = `${base}${path}`;
    const work = async () => {
      let response: Response;
      try {
        response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      } catch {
        throw new CatalogApiError('NETWORK');
      }
      let status: number;
      let ok: boolean;
      try {
        status = response.status;
        ok = response.ok;
        if (!Number.isInteger(status) || status < 200 || status > 599 || typeof ok !== 'boolean'
          || ok !== (status < 300)) throw new Error();
      } catch {
        throw new CatalogApiError('MALFORMED_RESPONSE');
      }
      if (!ok) throw httpError(status);
      let value: unknown;
      try {
        if (!validResponseUrl(response, url) || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
          throw new Error();
        }
        value = await response.json();
        if (!validate(value)) throw new Error();
      } catch {
        throw new CatalogApiError('MALFORMED_RESPONSE', status);
      }
      return value;
    };
    try { return await Promise.race([work(), interrupted]); }
    finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  }

  function resource<T extends { readonly _id: UUID }, Query extends object>(name: Resource, guard: Guard<T>) {
    return Object.freeze({
      async list(query: Query = {} as Query, options: CatalogReadOptions = {}): Promise<PageEnvelope<T>> {
        const { suffix, values } = queryString(name, query);
        const validate = (value: unknown): value is PageEnvelope<T> => {
          if (!isPageEnvelope(value, guard)) return false;
          if (value.pagination.page !== (values.page ?? 1) || value.pagination.limit !== (values.limit ?? 20)) return false;
          if (new Set(value.data.map(row => row._id.toLowerCase())).size !== value.data.length) return false;
          // Recipe associations are immutable; reject foreign context rather than displaying it.
          return name !== 'recipes' || value.data.every(row => recipeGuard(row)
            && (values.productId === undefined || row.productId.toLowerCase() === String(values.productId).toLowerCase())
            && (values.size === undefined || row.size === values.size));
        };
        return request(`/${name}${suffix}`, validate, readSignal(options));
      },
      async detail(id: UUID, options: CatalogReadOptions = {}): Promise<DataEnvelope<T>> {
        const path = idPath(id);
        const validate = (value: unknown): value is DataEnvelope<T> => isDataEnvelope(value, guard)
          && value.data._id.toLowerCase() === id.toLowerCase();
        return request(`/${name}/${path}`, validate, readSignal(options));
      },
    });
  }
  return Object.freeze({
    ingredients: resource<Ingredient, IngredientQuery>('ingredients', ingredientGuard),
    products: resource<Product, ProductQuery>('products', productGuard),
    recipes: resource<Recipe, RecipeQuery>('recipes', recipeGuard),
  });
}
export type CatalogClient = ReturnType<typeof createCatalogClient>;
