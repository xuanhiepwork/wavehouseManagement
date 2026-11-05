import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CatalogApiError } from '../api/catalog'
import type { CatalogClient, Ingredient, PageEnvelope, ProductSize, Recipe } from '../api/catalog'
import { useCatalogRead } from './useCatalogRead'
import type { RecipeLifecycleModel } from './useRecipeLifecycle'
import './RecipeLifecycle.css'

// History reads remain separate from the explicitly opened lifecycle review.
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

function HistoryReads({ client, productId, size, onViewRecipe, lifecycle, managementShown }: {
  client: HistoryClient; productId: string; size: ProductSize; onViewRecipe: (id: string, button: HTMLButtonElement) => void
  lifecycle?: RecipeLifecycleModel; managementShown: boolean
}) {
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  // Keep the focused refresh control mounted while replacing read state and its reference cache.
  return <>
    <div className="history-read-heading"><h3>History for size {size}</h3>
      <button type="button" disabled={lifecycle?.locked} onClick={() => setRevision(value => value + 1)}>Refresh history and active version</button></div>
    <HistoryPage key={revision} client={client} productId={productId} size={size} page={page} onPageChange={setPage}
      onViewRecipe={onViewRecipe} lifecycle={lifecycle} managementShown={managementShown} />
  </>
}

function HistoryPage({ client, productId, size, page, onPageChange, onViewRecipe, lifecycle, managementShown }: {
  client: HistoryClient; productId: string; size: ProductSize; page: number
  onPageChange: (page: number) => void
  onViewRecipe: (id: string, button: HTMLButtonElement) => void
  lifecycle?: RecipeLifecycleModel; managementShown: boolean
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
  const lifecycleDisabled = !!(lifecycle?.locked || lifecycle?.blockedByCreation || conflicting)
  const activeValidated = !!(currentActive && rows && !history.loading && !history.error && !active.loading && !active.error && !conflicting)
  const confirmedReadWarning = lifecycle?.confirmed ? ' The operation was confirmed; displayed data may be outdated. Retry reads only.' : ''
  return <>
    {conflicting && <p className="history-reference-warning" role="alert">History and active-version reads disagree. Server state may have changed between reads. Current active status cannot be confirmed across these reads; refresh history and active version.</p>}
    <section className="history-active" aria-label="Current active Recipe" aria-busy={active.loading}>
      <h3>Current active version</h3>
      {active.loading && <p role="status">Loading current active version...</p>}
      {active.error && <ReadError message={`Unable to establish the current active version. ${active.error}${confirmedReadWarning}`} retry={active.retry} label="Retry active version" />}
      {active.data === null && <p role="status">{conflicting ? 'The active-version read reported no active Recipe; history disagrees.' : 'No Recipe is currently active for this Product and size.'}</p>}
      {active.data && <><p><strong>{conflicting ? 'Active-version read reports' : 'Current active Recipe:'} v{active.data.version}</strong></p>
        <RecipeData recipe={active.data} read={read} />
        {managementShown && lifecycle && activeValidated && !rows?.some(recipe => sameId(recipe._id, active.data!._id))
          && <div className="history-lifecycle-actions"><button type="button" disabled={lifecycleDisabled}
            onClick={event => { void lifecycle.begin('deactivate', active.data!, event.currentTarget) }}>Deactivate version {active.data.version}</button></div>}</>}
    </section>
    <section aria-label="Recipe history versions" aria-busy={history.loading}>
      <h3>All Recipe versions</h3>
      <p className="muted">Active and inactive versions in server order. Status is recorded at each read.</p>
      {history.loading && <p className="feedback" role="status">Loading Recipe history...</p>}
      {history.error && <ReadError message={`Unable to load Recipe history. ${history.error}${confirmedReadWarning}`} retry={history.retry} label="Retry history" />}
      {rows && (rows.length === 0 ? <p className="feedback empty-state" role="status">{history.data!.pagination.total === 0
        ? 'No Recipe history for this Product and size.' : 'No versions remain on this page. Use Previous to view earlier pages.'}</p>
        : <ol className="history-version-list">{rows.map(recipe => <li className="history-version" key={recipe._id}>
          <article aria-label={`History version ${recipe.version}`}>
            <header><h4>Version {recipe.version}</h4><span className={`status ${recipe.isActive ? 'positive' : 'neutral'}`}>{recipe.isActive ? 'Active at history read' : 'Inactive at history read'}</span>
              {!conflicting && active.data && recipe.isActive && sameId(active.data._id, recipe._id) && <strong>Current active version</strong>}</header>
            <RecipeData recipe={recipe} read={read} />
            <div className="history-lifecycle-actions">
              <button type="button" disabled={lifecycle?.locked} onClick={event => onViewRecipe(recipe._id, event.currentTarget)}>View details for version {recipe.version}</button>
              {managementShown && lifecycle && (!recipe.isActive
                ? <button type="button" disabled={lifecycleDisabled || recipe.ingredients.length === 0}
                  onClick={event => { void lifecycle.begin('activate', recipe, event.currentTarget) }}>Activate version {recipe.version}</button>
                : activeValidated && currentActive && sameId(recipe._id, currentActive._id)
                  && <button type="button" disabled={lifecycleDisabled}
                    onClick={event => { void lifecycle.begin('deactivate', recipe, event.currentTarget) }}>Deactivate version {recipe.version}</button>)}
            </div>
            {managementShown && !recipe.isActive && recipe.ingredients.length === 0 && <p className="muted">This version cannot be activated because it has no Ingredient membership.</p>}
          </article>
        </li>)}</ol>)}
    </section>
    <footer className="pagination" aria-label="Recipe history pagination">
      <span aria-live="polite">History page {history.data?.pagination.page ?? page} of {history.data?.pagination.totalPages || 1} · 20 versions per page</span>
      <div><button type="button" aria-label="Previous history page" disabled={page <= 1 || history.loading || lifecycle?.locked} onClick={() => onPageChange(page - 1)}>Previous</button>
        <button type="button" aria-label="Next history page" disabled={!history.data || page >= history.data.pagination.totalPages || history.loading || lifecycle?.locked} onClick={() => onPageChange(page + 1)}>Next</button></div>
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

function LifecycleConfirmation({ lifecycle, onRefresh }: { lifecycle: RecipeLifecycleModel; onRefresh: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const { visible, phase, selection, snapshot } = lifecycle
  useEffect(() => {
    if (visible && ['checking', 'ready', 'blocked', 'uncertain', 'reconciled', 'rejected', 'confirmed'].includes(phase)) heading.current?.focus()
  }, [visible, phase])
  if (!visible || !selection) return null
  const target = snapshot?.target ?? selection.target
  const action = selection.action
  const isActivation = action === 'activate'
  const currentActive = snapshot?.active
  const olderVersion = snapshot?.history.some(recipe => recipe.version > target.version)
  const refreshable = ['uncertain', 'confirmed', 'rejected', 'reconciled', 'blocked'].includes(phase)
  const terminal = ['confirmed', 'reconciled', 'rejected'].includes(phase)
  const alert = ['blocked', 'uncertain', 'rejected'].includes(phase)
  const showBlockingIssues = ['ready', 'blocked', 'rechecking'].includes(phase) && !!snapshot?.issues.length
  const hasSnapshotAlerts = showBlockingIssues || !!snapshot?.referenceErrors.length
  return <section className="recipe-lifecycle-confirmation" role="dialog" aria-modal="false" aria-label="Recipe lifecycle confirmation" aria-busy={lifecycle.busy}>
    <h3 ref={heading} tabIndex={-1}>{isActivation ? 'Review Recipe activation' : 'Review Recipe deactivation'}</h3>
    <p className="lifecycle-message" role={alert && !hasSnapshotAlerts ? 'alert' : 'status'}>{lifecycle.message || (lifecycle.busy
      ? phase === 'saving' ? 'Submitting the confirmed Recipe action...' : 'Reading current server state for this Recipe action...'
      : phase === 'blocked' ? 'This action is blocked. Review the issues below.' : 'Review this Recipe action before confirming.')}</p>
    {phase === 'uncertain' && <p className="history-reference-warning">The result is uncertain. Success or failure has not been confirmed. Refresh server state to observe current data. An observed state does not establish which request or actor caused it.</p>}
    {phase === 'reconciled' && <p>Server state has been refreshed. This observation does not establish whether this operation caused that state. No mutation was retried.</p>}
    {lifecycle.confirmed && <p className="lifecycle-confirmed" role="status">The operation was confirmed by the server. If a read fails, displayed data may be outdated. Retry reads only.</p>}
    <dl className="history-version-fields">
      <div><dt>Action</dt><dd>{isActivation ? 'Activate' : 'Deactivate'} version {target.version}</dd></div>
      <div><dt>Recipe UUID</dt><dd><code>{target._id}</code></dd></div>
      <div><dt>Product</dt><dd>{snapshot?.product?.name ?? 'Current Product metadata unavailable'}</dd></div>
      <div><dt>Product UUID</dt><dd><code>{target.productId}</code></dd></div>
      <div><dt>Size</dt><dd>{target.size}</dd></div>
      <div><dt>Current active version</dt><dd>{snapshot ? currentActive ? <>Version {currentActive.version}<code>{currentActive._id}</code></> : 'No active Recipe' : 'Awaiting current server state'}</dd></div>
    </dl>
    {snapshot?.product && <p>Current Product code: {snapshot.product.code} · Current availability: {snapshot.product.isAvailable ? 'Available' : 'Unavailable'}</p>}
    {!['confirmed', 'reconciled'].includes(phase) && <p className="history-reference-warning">{isActivation
      ? currentActive && !sameId(currentActive._id, target._id)
        ? `Confirming activation of version ${target.version} replaces current active version ${currentActive.version}. Only this target will be active for this Product and size.`
        : `Confirming activation makes version ${target.version} the active Recipe for this Product and size.`
      : 'Deactivation clears only this target if it is still active; a different active version is never cleared. No earlier version is automatically activated.'}</p>}
    <p className="muted">Server state can still change after confirmation checks; the backend has no compare-and-swap guarantee.</p>
    {isActivation && olderVersion && <p>Version numbers do not restrict activation. This older version keeps its recorded version number when activated.</p>}
    <h4>Recorded Ingredient membership and quantities</h4>
    {target.ingredients.length === 0 ? <p>This version has no Ingredient membership. {isActivation ? 'It cannot be activated.' : 'Deactivation does not require Ingredient membership.'}</p>
      : <ul className="lifecycle-ingredients">{target.ingredients.map(item => {
        const ingredient = snapshot?.ingredients.find(reference => sameId(reference._id, item.ingredientId))
        return <li key={item.ingredientId}>
          <div className="history-reference"><strong>{ingredient?.name ?? 'Current Ingredient metadata unavailable'}</strong><code>{item.ingredientId}</code>
            {ingredient && <span>Current code: {ingredient.code} · Current unit: {ingredient.unit} · {ingredient.isActive ? 'Active Ingredient' : 'Inactive Ingredient'}</span>}</div>
          <p>Recorded quantity: <span className="decimal">{item.quantity}</span></p>
        </li>
      })}</ul>}
    {showBlockingIssues && snapshot && <div className="lifecycle-issues" role="alert"><h4>This action cannot be confirmed</h4>
      <ul>{snapshot.issues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}</ul></div>}
    {!!snapshot?.referenceErrors.length && <div className="lifecycle-reference-errors" role={showBlockingIssues ? undefined : 'alert'}><h4>Current reference metadata could not be read</h4>
      <ul>{snapshot.referenceErrors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul></div>}
    <div className="lifecycle-confirmation-actions">
      <button type="button" className="primary-button" disabled={!lifecycle.canConfirm} onClick={() => { void lifecycle.confirm(onRefresh) }}>{isActivation ? 'Confirm activation' : 'Confirm deactivation'}</button>
      <button type="button" disabled={!lifecycle.canCancel} onClick={lifecycle.cancel}>{terminal ? 'Close Recipe action' : 'Cancel Recipe action'}</button>
      {refreshable && <button type="button" disabled={lifecycle.busy} onClick={() => { void lifecycle.refreshServerState(onRefresh) }}>Refresh server state</button>}
    </div>
  </section>
}

export default function RecipeHistory({ client, context, revision, focusRequest, onContextChange, onViewRecipe, close, lifecycle, onLifecycleRefresh }: {
  client: HistoryClient; context?: RecipeHistoryContext; revision: number; focusRequest: number
  onContextChange: (context?: RecipeHistoryContext) => void
  onViewRecipe: (id: string, button: HTMLButtonElement) => void; close: () => void
  lifecycle?: RecipeLifecycleModel; onLifecycleRefresh?: () => void
}) {
  const [managementShown, setManagementShown] = useState(false)
  const managementId = useId()
  return <section className="recipe-history surface" aria-label="Recipe version history">
    <div className="panel-heading"><h2 key={focusRequest} tabIndex={-1} ref={focusHeading}>Recipe version history</h2><button type="button" disabled={lifecycle?.locked} onClick={close} aria-label="Close recipe history">Close</button></div>
    <div className="history-content">
      {lifecycle && <LifecycleConfirmation lifecycle={lifecycle} onRefresh={onLifecycleRefresh ?? (() => {})} />}
      <p>Recipe UUIDs, versions, timestamps and exact quantities come from historical Recipe data. Product and Ingredient names, codes, units and availability are current reference metadata. Historical names and units are not stored.</p>
      {lifecycle && <div className="history-management"><button type="button" aria-label={managementShown ? 'Hide Recipe lifecycle controls' : 'Show Recipe lifecycle controls'} aria-expanded={managementShown} aria-controls={managementId} disabled={lifecycle.locked}
        onClick={() => setManagementShown(value => !value)}>{managementShown ? 'Hide Recipe lifecycle controls' : 'Show Recipe lifecycle controls'}</button>
        {managementShown && <div id={managementId}><p>Recipe lifecycle controls open a fresh server review and a separate confirmation before activation or deactivation.</p>
          {lifecycle.blockedByCreation && <p className="history-reference-warning">Finish or reconcile the Recipe creation action before opening a Recipe lifecycle review.</p>}</div>}</div>}
      <fieldset className="history-context-controls" disabled={lifecycle?.locked}>
        <legend className="sr-only">Recipe history context</legend>
        <ProductPicker client={client} context={context} onChange={onContextChange} />
        {context ? <SelectedProduct key={`${context.productId}:${revision}`} client={client} context={context} onChange={onContextChange} />
          : <p>Select a Product and supported size to view its Recipe history.</p>}
      </fieldset>
      {context?.size && <HistoryReads key={`${context.productId}:${context.size}:${revision}`} client={client} productId={context.productId} size={context.size} onViewRecipe={onViewRecipe}
        lifecycle={lifecycle} managementShown={managementShown} />}
    </div>
  </section>
}
