import { useCallback, useId, useMemo, useState } from 'react'
import { CatalogApiError } from '../api/catalog'
import type { CatalogClient, Ingredient, PageEnvelope, ProductSize, Recipe } from '../api/catalog'
import { useCatalogRead } from './useCatalogRead'
import './RecipeLifecycle.css'

// History is deliberately given no mutation capabilities.
type HistoryClient = {
  products: Pick<CatalogClient['products'], 'list' | 'detail'>
  ingredients: Pick<CatalogClient['ingredients'], 'detail'>
  recipes: Pick<CatalogClient['recipes'], 'list'>
}
export interface RecipeHistoryContext { productId: string; size?: ProductSize }
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const focusHeading = (node: HTMLHeadingElement | null) => { node?.focus() }

function ReadError({ message, retry, label }: { message: string; retry: () => void; label: string }) {
  return <div className="error-state" role="alert"><p>{message}</p><button type="button" onClick={retry}>{label}</button></div>
}

function ProductPicker({ client, context, onChange }: {
  client: HistoryClient; context?: RecipeHistoryContext; onChange: (context?: RecipeHistoryContext) => void
}) {
  const id = useId()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState({ search: '', page: 1 })
  const load = useCallback(() => client.products.list({ search: query.search || undefined, page: query.page, limit: 20 }), [client, query])
  const state = useCatalogRead(load)
  const selectedProduct = state.data?.data.find(product => context && sameId(product._id, context.productId))
  return <section className="history-product-picker" aria-label="History Product selection">
    <h3>Choose a Product</h3>
    <div className="history-product-search">
      <label htmlFor={`${id}-search`}>Search history products<input id={`${id}-search`} type="search" value={search}
        placeholder="Code or name" onChange={event => setSearch(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setQuery({ search: search.trim(), page: 1 }) } }} /></label>
      <button type="button" onClick={() => setQuery({ search: search.trim(), page: 1 })}>Find Products</button>
    </div>
    <p className="muted">Includes available and unavailable Products. Product metadata is current.</p>
    {state.loading && <p role="status">Loading history Products...</p>}
    {state.error && <ReadError message={state.error} retry={state.retry} label="Retry history Products" />}
    <label htmlFor={`${id}-product`}>History Product<select id={`${id}-product`} value={selectedProduct?._id ?? context?.productId ?? ''}
      onChange={event => onChange(event.target.value ? { productId: event.target.value } : undefined)}>
      <option value="">Choose a Product</option>
      {context && !selectedProduct
        && <option value={context.productId}>{context.productId} (selected Product)</option>}
      {state.data?.data.map(product => <option key={product._id} value={product._id}>
        {product.code} / {product.name}{product.isAvailable ? '' : ' (Unavailable)'}
      </option>)}
    </select></label>
    {state.data?.data.length === 0 && <p>No Products match this search.</p>}
    <footer className="pagination" aria-label="History Product selection pagination">
      <span aria-live="polite">Product page {state.data?.pagination.page ?? query.page} of {state.data?.pagination.totalPages || 1}</span>
      <div><button type="button" aria-label="Previous history Products page" disabled={query.page <= 1 || state.loading}
        onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}>Previous</button>
        <button type="button" aria-label="Next history Products page" disabled={!state.data || query.page >= state.data.pagination.totalPages || state.loading}
          onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Next</button></div>
    </footer>
  </section>
}

// Share current Ingredient metadata within these reads. Failures remain independently retryable.
function ingredientReader(client: HistoryClient) {
  const pending = new Map<string, Promise<Ingredient>>()
  return (id: string) => {
    const key = id.toLowerCase()
    let result = pending.get(key)
    if (!result) {
      result = Promise.resolve().then(() => client.ingredients.detail(id)).then(({ data }) => {
        if (!sameId(data._id, id)) throw new CatalogApiError('MALFORMED_RESPONSE')
        return data
      }).catch(error => { pending.delete(key); throw error })
      pending.set(key, result)
    }
    return result
  }
}
function IngredientReference({ id, read }: { id: string; read: ReturnType<typeof ingredientReader> }) {
  const load = useCallback(() => read(id), [read, id])
  const state = useCatalogRead(load)
  return <div className="history-reference">
    <code>{id}</code>
    {state.loading && <span role="status">Loading current Ingredient metadata...</span>}
    {state.error && <ReadError message={`Current Ingredient metadata unavailable. ${state.error}`} retry={state.retry} label={`Retry Ingredient ${id}`} />}
    {state.data && <><strong>{state.data.name}</strong><span>Current code: {state.data.code} · Current unit: {state.data.unit}</span>
      <span className={`status ${state.data.isActive ? 'positive' : 'neutral'}`}>{state.data.isActive ? 'Active Ingredient' : 'Inactive Ingredient'}</span></>}
  </div>
}
function RecipeData({ recipe, read }: { recipe: Recipe; read: ReturnType<typeof ingredientReader> }) {
  return <>
    <dl className="history-version-fields">
      <div><dt>Recipe UUID</dt><dd><code>{recipe._id}</code></dd></div>
      <div><dt>Product UUID</dt><dd><code>{recipe.productId}</code></dd></div>
      <div><dt>Size</dt><dd>{recipe.size}</dd></div>
      <div><dt>Created</dt><dd><time dateTime={recipe.createdAt}>{recipe.createdAt}</time></dd></div>
      <div><dt>Updated</dt><dd><time dateTime={recipe.updatedAt}>{recipe.updatedAt}</time></dd></div>
    </dl>
    <h4>Ingredients &amp; quantities</h4>
    {recipe.ingredients.length === 0 ? <p>This historical Recipe has no Ingredient membership. Empty membership is valid historical data.</p>
      : <ul className="history-ingredients">{recipe.ingredients.map(item => <li className="history-ingredient" key={item.ingredientId}>
        <IngredientReference id={item.ingredientId} read={read} />
        <p>Recipe quantity: <span className="decimal">{item.quantity}</span></p>
      </li>)}</ul>}
  </>
}

function validateContext(rows: Recipe[], productId: string, size: ProductSize) {
  if (rows.some(row => !sameId(row.productId, productId) || row.size !== size)
    || new Set(rows.map(row => row._id.toLowerCase())).size !== rows.length
    || new Set(rows.map(row => row.version)).size !== rows.length) throw new CatalogApiError('MALFORMED_RESPONSE')
}

function HistoryReads({ client, productId, size, onViewRecipe }: {
  client: HistoryClient; productId: string; size: ProductSize; onViewRecipe: (id: string, button: HTMLButtonElement) => void
}) {
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  // Refresh remounts read state and its reference cache while retaining this context's page.
  return <HistoryPage key={revision} client={client} productId={productId} size={size} page={page} onPageChange={setPage}
    onRefresh={() => setRevision(value => value + 1)} onViewRecipe={onViewRecipe} />
}

function HistoryPage({ client, productId, size, page, onPageChange, onRefresh, onViewRecipe }: {
  client: HistoryClient; productId: string; size: ProductSize; page: number
  onPageChange: (page: number) => void; onRefresh: () => void
  onViewRecipe: (id: string, button: HTMLButtonElement) => void
}) {
  const loadHistory = useCallback(async (): Promise<PageEnvelope<Recipe>> => {
    const result = await client.recipes.list({ productId, size, page, limit: 20 })
    validateContext(result.data, productId, size)
    const expected = Math.min(20, Math.max(0, result.pagination.total - (page - 1) * 20))
    if (result.pagination.page !== page || result.pagination.limit !== 20 || result.data.length !== expected) {
      throw new CatalogApiError('MALFORMED_RESPONSE')
    }
    return result
  }, [client, productId, size, page])
  const loadActive = useCallback(async () => {
    const result = await client.recipes.list({ productId, size, isActive: true })
    validateContext(result.data, productId, size)
    if (result.pagination.page !== 1 || result.pagination.total > 1 || result.data.length !== result.pagination.total
      || result.data.some(row => !row.isActive)) throw new CatalogApiError('MALFORMED_RESPONSE')
    return result.data[0] ?? null
  }, [client, productId, size])
  const history = useCatalogRead(loadHistory)
  const active = useCatalogRead(loadActive)
  const read = useMemo(() => ingredientReader(client), [client])
  const rows = history.data?.data
  const currentActive = active.data
  const completeHistory = history.data && history.data.pagination.total <= 20 && page === 1
  const conflicting = rows && currentActive !== undefined && (
    (completeHistory && currentActive !== null && !rows.some(row => sameId(row._id, currentActive._id)))
    || rows.filter(row => row.isActive).length > 1
    || (currentActive !== null && rows.some(row => row.version === currentActive.version && !sameId(row._id, currentActive._id)))
    || rows.some(row => row.isActive
      ? !currentActive || !sameId(row._id, currentActive._id) || row.version !== currentActive.version
      : currentActive && sameId(row._id, currentActive._id))
  )
  return <>
    <div className="history-read-heading"><h3>History for size {size}</h3>
      <button type="button" onClick={onRefresh}>Refresh history and active version</button></div>
    {conflicting && <p className="history-reference-warning" role="alert">History and active-version reads disagree. Server state may have changed between reads. Current active status cannot be confirmed across these reads; refresh history and active version.</p>}
    <section className="history-active" aria-label="Current active Recipe" aria-busy={active.loading}>
      <h3>Current active version</h3>
      {active.loading && <p role="status">Loading current active version...</p>}
      {active.error && <ReadError message={`Unable to establish the current active version. ${active.error}`} retry={active.retry} label="Retry active version" />}
      {active.data === null && <p role="status">{conflicting ? 'The active-version read reported no active Recipe; history disagrees.' : 'No Recipe is currently active for this Product and size.'}</p>}
      {active.data && <><p><strong>{conflicting ? 'Active-version read reports' : 'Current active Recipe:'} v{active.data.version}</strong></p>
        <RecipeData recipe={active.data} read={read} /></>}
    </section>
    <section aria-label="Recipe history versions" aria-busy={history.loading}>
      <h3>All Recipe versions</h3>
      <p className="muted">Active and inactive versions in server order. Status is recorded at each read.</p>
      {history.loading && <p className="feedback" role="status">Loading Recipe history...</p>}
      {history.error && <ReadError message={`Unable to load Recipe history. ${history.error}`} retry={history.retry} label="Retry history" />}
      {rows && (rows.length === 0 ? <p className="feedback empty-state" role="status">{history.data!.pagination.total === 0
        ? 'No Recipe history for this Product and size.' : 'No versions remain on this page. Use Previous to view earlier pages.'}</p>
        : <ol className="history-version-list">{rows.map(recipe => <li className="history-version" key={recipe._id}>
          <article aria-label={`History version ${recipe.version}`}>
            <header><h4>Version {recipe.version}</h4><span className={`status ${recipe.isActive ? 'positive' : 'neutral'}`}>{recipe.isActive ? 'Active at history read' : 'Inactive at history read'}</span>
              {!conflicting && active.data && recipe.isActive && sameId(active.data._id, recipe._id) && <strong>Current active version</strong>}</header>
            <RecipeData recipe={recipe} read={read} />
            <button type="button" onClick={event => onViewRecipe(recipe._id, event.currentTarget)}>View details for version {recipe.version}</button>
          </article>
        </li>)}</ol>)}
    </section>
    <footer className="pagination" aria-label="Recipe history pagination">
      <span aria-live="polite">History page {history.data?.pagination.page ?? page} of {history.data?.pagination.totalPages || 1} · 20 versions per page</span>
      <div><button type="button" aria-label="Previous history page" disabled={page <= 1 || history.loading} onClick={() => onPageChange(page - 1)}>Previous</button>
        <button type="button" aria-label="Next history page" disabled={!history.data || page >= history.data.pagination.totalPages || history.loading} onClick={() => onPageChange(page + 1)}>Next</button></div>
    </footer>
  </>
}

function SelectedProduct({ client, context, onChange }: {
  client: HistoryClient; context: RecipeHistoryContext; onChange: (context: RecipeHistoryContext) => void
}) {
  const id = useId()
  const load = useCallback(async () => {
    const { data } = await client.products.detail(context.productId)
    if (!sameId(data._id, context.productId)) throw new CatalogApiError('MALFORMED_RESPONSE')
    return data
  }, [client, context.productId])
  const state = useCatalogRead(load)
  const focusSize = useCallback((node: HTMLSelectElement | null) => { if (!context.size) node?.focus() }, [context.size])
  const sizes = (['S', 'M', 'L'] as const).filter(size => state.data?.prices.some(price => price.size === size))
  return <section className="history-context" aria-label="History Product details">
    <h3>Current Product metadata</h3><code>{context.productId}</code>
    {state.loading && <p role="status">Loading current Product metadata...</p>}
    {state.error && <ReadError message={`Current Product metadata unavailable. ${state.error} Existing history remains readable by UUID.`} retry={state.retry} label="Retry Product details" />}
    {state.data && <><p><strong>{state.data.name}</strong> · Current code: {state.data.code} · {state.data.isAvailable ? 'Available' : 'Unavailable'}</p>
      <label htmlFor={`${id}-size`}>History size<select id={`${id}-size`} ref={focusSize} value={context.size ?? ''}
        onChange={event => onChange({ productId: context.productId, size: (event.target.value || undefined) as ProductSize | undefined })}>
        <option value="">Choose a supported size</option>
        {context.size && !sizes.includes(context.size) && <option value={context.size}>{context.size} (historical size)</option>}
        {sizes.map(size => <option key={size}>{size}</option>)}
      </select></label>
      {context.size && !sizes.includes(context.size) && <p>This historical size is no longer supported by the current Product. Its history is still readable.</p>}</>}
  </section>
}

export default function RecipeHistory({ client, context, revision, focusRequest, onContextChange, onViewRecipe, close }: {
  client: HistoryClient; context?: RecipeHistoryContext; revision: number; focusRequest: number
  onContextChange: (context?: RecipeHistoryContext) => void
  onViewRecipe: (id: string, button: HTMLButtonElement) => void; close: () => void
}) {
  return <section className="recipe-history surface" aria-label="Recipe version history">
    <div className="panel-heading"><h2 key={focusRequest} tabIndex={-1} ref={focusHeading}>Recipe version history</h2><button type="button" onClick={close} aria-label="Close recipe history">Close</button></div>
    <div className="history-content">
      <p>Recipe UUIDs, versions, timestamps and exact quantities come from historical Recipe data. Product and Ingredient names, codes, units and availability are current reference metadata. Historical names and units are not stored.</p>
      <ProductPicker client={client} context={context} onChange={onContextChange} />
      {context ? <SelectedProduct key={`${context.productId}:${revision}`} client={client} context={context} onChange={onContextChange} />
        : <p>Select a Product and supported size to view its Recipe history.</p>}
      {context?.size && <HistoryReads key={`${context.productId}:${context.size}:${revision}`} client={client} productId={context.productId} size={context.size} onViewRecipe={onViewRecipe} />}
    </div>
  </section>
}
