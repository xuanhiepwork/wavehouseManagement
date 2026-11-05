import { CatalogApiError, httpError } from './catalog.errors'
import type {
  Ingredient, IngredientInput, IngredientQuery, Product, ProductInput, ProductQuery,
  Recipe, RecipeInput, RecipeQuery, DataEnvelope, PageEnvelope, UUID,
} from './catalog.types'

export { CatalogApiError } from './catalog.errors'
export type * from './catalog.types'

type ObjectValue = Record<string, unknown>
type Guard<T> = (value: unknown) => value is T
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const uuid = (v: unknown): v is UUID => text(v) && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const size = (v: unknown) => v === 'S' || v === 'M' || v === 'L'
// Check canonical notation and PostgreSQL numeric(18, scale) without numeric coercion.
function decimal(v: unknown, scale: number, canonical = true): v is string {
  if (!text(v) || v.length > 100 || !/^\d+(?:\.\d+)?$/.test(v)) return false
  const [whole, fraction = ''] = v.split('.')
  if (whole.replace(/^0+(?=\d)/, '').length > 18 - scale || fraction.length > scale) return false
  return !canonical || (/^(0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(v))
}
const timestamp = (v: unknown) => text(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v))
const metadata = (v: ObjectValue) => uuid(v._id) && timestamp(v.createdAt) && timestamp(v.updatedAt) && !('__v' in v)
const common = (v: ObjectValue) => metadata(v) && text(v.code) && text(v.name) && text(v.category)
const ingredient: Guard<Ingredient> = (v): v is Ingredient => object(v) && common(v)
  && ['g', 'ml', 'piece'].includes(v.unit as string) && decimal(v.costPrice, 4)
  && decimal(v.minStock, 6) && typeof v.isActive === 'boolean'
const product: Guard<Product> = (v): v is Product => object(v) && common(v)
  && (v.description === undefined || text(v.description)) && (v.imageUrl === undefined || text(v.imageUrl))
  && typeof v.isAvailable === 'boolean' && Array.isArray(v.prices) && v.prices.length > 0 && v.prices.length <= 3
  && v.prices.every(p => object(p) && size(p.size) && decimal(p.price, 4))
  && new Set(v.prices.map(p => p.size)).size === v.prices.length
// Historical reads and deactivation may return an empty Recipe; creation and activation require Ingredients.
const recipeRead: Guard<Recipe> = (v): v is Recipe => object(v) && metadata(v) && uuid(v.productId) && size(v.size)
  && integer(v.version) && v.version > 0 && typeof v.isActive === 'boolean'
  && Array.isArray(v.ingredients)
  && v.ingredients.every(i => object(i) && uuid(i.ingredientId) && decimal(i.quantity, 6) && i.quantity !== '0')
  && new Set(v.ingredients.map(i => i.ingredientId)).size === v.ingredients.length
// Creation and activation keep their nonempty response validation.
const recipe: Guard<Recipe> = (v): v is Recipe => recipeRead(v) && v.ingredients.length > 0

function envelope<T>(guard: Guard<T>, listing: boolean, value: unknown): boolean {
  if (!object(value)) return false
  if (!listing) return guard(value.data)
  if (!Array.isArray(value.data) || !value.data.every(guard) || !object(value.pagination)) return false
  const p = value.pagination
  return integer(p.page) && p.page > 0 && integer(p.limit) && p.limit > 0 && p.limit <= 100
    && integer(p.total) && integer(p.totalPages) && p.totalPages === Math.ceil(p.total / p.limit)
    && value.data.length <= p.limit
}

function baseUrl(value: unknown): string {
  try {
    if (!text(value) || !/^https?:\/\//.test(value)) throw new Error()
    const url = new URL(value)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash
      || !['/', '/api', '/api/'].includes(url.pathname)) throw new Error()
    return `${url.origin}/api`
  } catch {
    throw new CatalogApiError('CONFIGURATION')
  }
}

function idPath(id: UUID): string {
  if (!uuid(id)) throw new CatalogApiError('BAD_REQUEST')
  return encodeURIComponent(id)
}

/** Omit only undefined: false, zero and empty strings must reach backend validation. */
function queryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (!['string', 'boolean', 'number'].includes(typeof value)
      || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new CatalogApiError('BAD_REQUEST')
    params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

// Enforce string decimals even for untyped callers; the backend owns other business validation.
function checkPayload(body: object, kind: 'ingredients' | 'products' | 'recipes'): void {
  if (!object(body)) throw new CatalogApiError('BAD_REQUEST')
  const invalid = () => { throw new CatalogApiError('BAD_REQUEST') }
  if (kind === 'ingredients') {
    for (const [field, scale] of [['costPrice', 4], ['minStock', 6]] as const) {
      if (field in body && !decimal(body[field], scale, false)) invalid()
    }
  } else if (kind === 'products' && 'prices' in body) {
    if (!Array.isArray(body.prices) || !body.prices.every(p => object(p) && decimal(p.price, 4, false))) invalid()
  } else if (kind === 'recipes') {
    if (!uuid(body.productId) || !Array.isArray(body.ingredients)
      || !body.ingredients.every(i => object(i) && uuid(i.ingredientId) && decimal(i.quantity, 6, false))) invalid()
  }
}

export interface CatalogClientOptions {
  /** Explicit local origin or origin/api. Defaults only to VITE_API_BASE_URL, never a remote endpoint. */
  baseUrl?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

/** Construction is lazy/explicit so importing the client never changes the starter UI. */
export function createCatalogClient(options: CatalogClientOptions = {}) {
  const base = baseUrl(options.baseUrl ?? import.meta.env.VITE_API_BASE_URL)
  const timeoutMs = options.timeoutMs ?? 10_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new CatalogApiError('CONFIGURATION')
  }
  const fetcher = options.fetch ?? globalThis.fetch

  async function request<T>(path: string, method: string, guard: Guard<T>, listing: true, body?: object): Promise<PageEnvelope<T>>
  async function request<T>(path: string, method: string, guard: Guard<T>, listing?: false, body?: object): Promise<DataEnvelope<T>>
  async function request<T>(path: string, method: string, guard: Guard<T>, listing = false, body?: object) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CatalogApiError('TIMEOUT'))
        controller.abort()
      }, timeoutMs)
    })
    const work = async () => {
      let response: Response
      try {
        response = await fetcher(`${base}${path}`, {
          method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal, credentials: 'omit', redirect: 'error',
        })
      } catch {
        throw new CatalogApiError('NETWORK')
      }
      // Never propagate server error bodies, even if malformed or unexpectedly detailed.
      if (!response.ok) throw httpError(response.status)
      let value: unknown
      try {
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error()
        value = await response.json()
      } catch {
        throw new CatalogApiError('MALFORMED_RESPONSE', response.status)
      }
      if (!envelope(guard, listing, value)) throw new CatalogApiError('MALFORMED_RESPONSE', response.status)
      return value as DataEnvelope<T> | PageEnvelope<T>
    }
    try {
      return await Promise.race([work(), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  function resource<T, Input extends object, Query extends object>(path: 'ingredients' | 'products', guard: Guard<T>) {
    return {
      list: (query: Query = {} as Query) => request(`/${path}${queryString(query)}`, 'GET', guard, true),
      detail: (id: UUID) => request(`/${path}/${idPath(id)}`, 'GET', guard),
      create: (input: Input) => {
        checkPayload(input, path)
        return request(`/${path}`, 'POST', guard, false, input)
      },
      update: (id: UUID, input: Partial<Input>) => {
        checkPayload(input, path)
        return request(`/${path}/${idPath(id)}`, 'PATCH', guard, false, input)
      },
      softDelete: (id: UUID) => request(`/${path}/${idPath(id)}`, 'DELETE', guard),
    }
  }
  return {
    ingredients: resource<Ingredient, IngredientInput, IngredientQuery>('ingredients', ingredient),
    products: resource<Product, ProductInput, ProductQuery>('products', product),
    recipes: {
      list: (query: RecipeQuery = {}) => request(`/recipes${queryString(query)}`, 'GET', recipeRead, true),
      detail: (id: UUID) => request(`/recipes/${idPath(id)}`, 'GET', recipeRead),
      create: (input: RecipeInput) => {
        checkPayload(input, 'recipes')
        return request('/recipes', 'POST', recipe, false, input)
      },
      activate: (id: UUID) => request(`/recipes/${idPath(id)}/activate`, 'POST', recipe),
      deactivate: (id: UUID) => request(`/recipes/${idPath(id)}/deactivate`, 'POST', recipeRead),
    },
  }
}

export type CatalogClient = ReturnType<typeof createCatalogClient>
