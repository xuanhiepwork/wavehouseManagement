import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { CatalogClient, Ingredient, IngredientQuery, PageEnvelope, Product, ProductSize, Recipe, BaseUnit } from '../api/catalog'
import CatalogCreation from './CatalogCreation'
import { useCatalogCreation } from './useCatalogCreation'
import type { CatalogCreationModel, CreationClient } from './useCatalogCreation'
import { useCatalogRead } from './useCatalogRead'
import RecipeCreation from './RecipeCreation'
import RecipeHistory from './RecipeHistory'
import type { RecipeHistoryContext } from './RecipeHistory'
import { useRecipeCreation } from './useRecipeCreation'
import type { RecipeCreationClient, RecipeCreationModel } from './useRecipeCreation'
import './Catalog.css'

// List/detail views receive reads only. Creation models expose no Recipe lifecycle actions.
type ReadClient = { [K in keyof CatalogClient]: Pick<CatalogClient[K], 'list' | 'detail'> }
type WorkspaceClient = ReadClient & CreationClient & RecipeCreationClient
type Section = keyof ReadClient
type RecordItem = Ingredient | Product | Recipe
const sections: Section[] = ['ingredients', 'products', 'recipes']
const titles: Record<Section, string> = { ingredients: 'Ingredients', products: 'Products', recipes: 'Recipes' }
const descriptions: Record<Section, string> = {
  ingredients: 'Explore the ingredients behind every recipe.',
  products: 'Browse your product range and size prices.',
  recipes: 'Explore recipe versions and their ingredients.',
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="feedback error-state" role="alert"><strong>Unable to load</strong><p>{message}</p><button type="button" onClick={retry}>Retry</button></div>
}
function Status({ active, available = false }: { active: boolean; available?: boolean }) {
  return <span className={`status ${active ? 'positive' : 'neutral'}`}><span aria-hidden="true" />{available ? (active ? 'Available' : 'Unavailable') : (active ? 'Active' : 'Inactive')}</span>
}
function Prices({ product }: { product: Product }) {
  return <span className="prices">{(['S', 'M', 'L'] as const).map(size => {
    const entry = product.prices.find(price => price.size === size)
    return entry ? <span key={size}><span className="size-label">{size}</span> <span className="decimal">{entry.price}</span></span> : null
  })}</span>
}
// Share reference reads within a result page. Evict failed lookups so Retry requests fresh data.
function referenceReader(client: ReadClient) {
  const products = new Map<string, Promise<Product>>()
  const ingredients = new Map<string, Promise<Ingredient>>()
  function read<T>(cache: Map<string, Promise<T>>, id: string, load: () => Promise<{ data: T }>) {
    let pending = cache.get(id)
    if (!pending) {
      pending = Promise.resolve().then(load).then(value => value.data).catch(error => { cache.delete(id); throw error })
      cache.set(id, pending)
    }
    return pending
  }
  return {
    product: (id: string) => read(products, id, () => client.products.detail(id)),
    ingredient: (id: string) => read(ingredients, id, () => client.ingredients.detail(id)),
  }
}
type ReferenceReader = ReturnType<typeof referenceReader>
function Reference({ id, kind, reader }: { id: string; kind: 'product' | 'ingredient'; reader: ReferenceReader }) {
  const load = useCallback((): Promise<Product | Ingredient> => reader[kind](id), [reader, kind, id])
  const state = useCatalogRead(load)
  return <span className="reference">
    {state.loading && <span role="status">Loading {kind}…</span>}
    {state.error && <span><span role="alert">Name unavailable. {state.error}</span> <button className="text-button" type="button" onClick={state.retry}>Retry {kind} name</button></span>}
    {state.data && <span className="reference-name">{state.data.name} <Status active={'isActive' in state.data ? state.data.isActive : state.data.isAvailable} available={kind === 'product'} /></span>}
    <code>{id}</code>
  </span>
}
function RecipeIngredients({ recipe, reader }: { recipe: Recipe; reader: ReferenceReader }) {
  return <ul className="recipe-ingredients">{recipe.ingredients.map(item => <li key={item.ingredientId}>
    <Reference kind="ingredient" id={item.ingredientId} reader={reader} />
    <span className="quantity"><span className="muted">Quantity </span><span className="decimal">{item.quantity}</span></span>
  </li>)}</ul>
}
interface Filters {
  search: string; category: string; unit: string; status: string; productId: string; size: string
  sortBy: IngredientQuery['sortBy']; sortOrder: 'asc' | 'desc'
}
const defaults: Filters = { search: '', category: '', unit: '', status: '', productId: '', size: '', sortBy: 'name', sortOrder: 'asc' }
function FilterForm({ section, onApply }: { section: Section; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState(defaults)
  function field(key: keyof Filters, value: string) { setDraft(previous => ({ ...previous, [key]: value })) }
  function submit(event: FormEvent) { event.preventDefault(); onApply(draft) }
  return <form className="filters" aria-label={`${titles[section]} filters`} onSubmit={submit}>
    {section !== 'recipes' ? <>
      <label className="search-filter">Search<input type="search" value={draft.search} onChange={e => field('search', e.target.value)} placeholder="Code or name" /></label>
      <label>Category<input value={draft.category} onChange={e => field('category', e.target.value)} placeholder="Any category" /></label>
    </> : <>
      <label className="search-filter">Product ID<input value={draft.productId} onChange={e => field('productId', e.target.value)} placeholder="Any product (UUID)" pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}" /></label>
      <label>Size<select value={draft.size} onChange={e => field('size', e.target.value)}><option value="">All sizes</option>{['S', 'M', 'L'].map(size => <option key={size}>{size}</option>)}</select></label>
    </>}
    {section === 'ingredients' && <label>Unit<select value={draft.unit} onChange={e => field('unit', e.target.value)}><option value="">All units</option><option value="g">g</option><option value="ml">ml</option><option value="piece">piece</option></select></label>}
    <label>{section === 'products' ? 'Availability' : 'Status'}<select value={draft.status} onChange={e => field('status', e.target.value)}>
      <option value="">{section === 'ingredients' ? 'Active (default)' : 'All'}</option><option value="true">{section === 'products' ? 'Available' : 'Active'}</option><option value="false">{section === 'products' ? 'Unavailable' : 'Inactive'}</option>
    </select></label>
    {section === 'ingredients' && <>
      <label>Sort by<select value={draft.sortBy} onChange={e => field('sortBy', e.target.value)}>{(['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'] as const).map(value => <option key={value} value={value}>{({ name: 'Name', code: 'Code', category: 'Category', unit: 'Unit', costPrice: 'Cost price', minStock: 'Min. stock', createdAt: 'Created', updatedAt: 'Updated' })[value]}</option>)}</select></label>
      <label>Order<select value={draft.sortOrder} onChange={e => field('sortOrder', e.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
    </>}
    <div className="filter-actions"><button className="primary-button" type="submit">Apply filters</button><button type="button" onClick={() => { setDraft(defaults); onApply(defaults) }}>Reset</button></div>
  </form>
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div> }
function ProductImage({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  let safe = false
  try { const parsed = new URL(url ?? ''); safe = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { /* Optional strings may not be URLs. */ }
  return safe && !failed ? <img className="product-image" src={url} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <div className="image-placeholder">{failed ? 'Image unavailable' : 'No image available'}</div>
}
function RecordDetails({ item, reader }: { item: RecordItem; reader: ReferenceReader }) {
  return <><h3>{'name' in item ? item.name : `Recipe · ${item.size}`}</h3><dl className="detail-fields">
    <Field label="ID"><code>{item._id}</code></Field>
    {'code' in item && <><Field label="Code">{item.code}</Field><Field label="Category">{item.category}</Field></>}
    {'costPrice' in item ? <>
      <Field label="Unit">{item.unit}</Field><Field label="Cost price"><span className="decimal">{item.costPrice}</span></Field><Field label="Minimum stock"><span className="decimal">{item.minStock}</span></Field><Field label="Status"><Status active={item.isActive} /></Field>
    </> : 'prices' in item ? <>
      <Field label="Availability"><Status active={item.isAvailable} available /></Field><Field label="Size prices"><Prices product={item} /></Field><Field label="Description">{item.description || 'No description provided.'}</Field>
    </> : <>
      <Field label="Product"><Reference kind="product" id={item.productId} reader={reader} /></Field><Field label="Size">{item.size}</Field><Field label="Version">{item.version}</Field><Field label="Status"><Status active={item.isActive} /></Field>
    </>}
    <Field label="Created">{item.createdAt}</Field><Field label="Updated">{item.updatedAt}</Field>
  </dl>{'prices' in item && <ProductImage key={item.imageUrl} url={item.imageUrl} name={item.name} />}
    {'ingredients' in item && <><h3>Ingredients & quantities</h3><RecipeIngredients recipe={item} reader={reader} /></>}
  </>
}
function DetailPanel({ client, section, id, reader, close }: { client: ReadClient; section: Section; id: string; reader: ReferenceReader; close: () => void }) {
  const load = useCallback(async (): Promise<RecordItem> => (await client[section].detail(id)).data, [client, section, id])
  const state = useCatalogRead(load)
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => { node?.focus() }, [])
  return <section className="detail-panel surface" aria-label="Record details"><div className="panel-heading"><h2 tabIndex={-1} ref={focusHeading}>Record details</h2><button type="button" onClick={close} aria-label="Close details">Close</button></div>
    {state.loading && <p className="feedback" role="status">Loading details…</p>}{state.error && <ErrorState message={state.error} retry={state.retry} />}{state.data && <RecordDetails item={state.data} reader={reader} />}
  </section>
}
function Workspace({ section, client, creation, recipeCreation }: { section: Section; client: WorkspaceClient; creation?: CatalogCreationModel; recipeCreation?: RecipeCreationModel }) {
  const [filters, setFilters] = useState(defaults)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<string>()
  const [notice, setNotice] = useState('')
  const [detailRevision, setDetailRevision] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyContext, setHistoryContext] = useState<RecipeHistoryContext>()
  const [historyRevision, setHistoryRevision] = useState(0)
  const [historyFocusRequest, setHistoryFocusRequest] = useState(0)
  const historyButton = useRef<HTMLButtonElement | null>(null)
  const historyOpener = useRef<HTMLButtonElement | null>(null)
  const selectionButton = useRef<HTMLButtonElement | null>(null)
  const creationButton = useRef<HTMLButtonElement | null>(null)
  const creationWasVisible = useRef(false)
  const creationOpenedDetails = useRef(false)
  const creationVisible = Boolean(creation?.visible || recipeCreation?.visible)
  useEffect(() => {
    if (creationVisible) creationOpenedDetails.current = false
    if (creationWasVisible.current && !creationVisible && !creationOpenedDetails.current) creationButton.current?.focus()
    creationWasVisible.current = creationVisible
  }, [creationVisible, selected])
  const load = useCallback(async (): Promise<PageEnvelope<RecordItem> & { reader: ReferenceReader }> => {
    const paging = { page, limit }
    const active = filters.status === '' ? undefined : filters.status === 'true'
    let result: PageEnvelope<RecordItem>
    if (section === 'ingredients') result = await client.ingredients.list({ ...paging, search: filters.search.trim() || undefined, category: filters.category.trim() || undefined, unit: (filters.unit || undefined) as BaseUnit | undefined, isActive: active, sortBy: filters.sortBy, sortOrder: filters.sortOrder })
    else if (section === 'products') result = await client.products.list({ ...paging, search: filters.search.trim() || undefined, category: filters.category.trim() || undefined, isAvailable: active })
    else result = await client.recipes.list({ ...paging, productId: filters.productId.trim() || undefined, size: (filters.size || undefined) as ProductSize | undefined, isActive: active })
    return { ...result, reader: referenceReader(client) }
  }, [client, section, filters, page, limit])
  const state = useCatalogRead(load)
  const data = state.data
  const reader = data?.reader
  function select(id: string, button: HTMLButtonElement) { selectionButton.current = button; setSelected(id) }
  function changePage(next: number) { setPage(next); setSelected(undefined) }
  function apply(next: Filters) { setFilters({ ...next }); setPage(1); setSelected(undefined) }
  function created(record: Ingredient | Product) {
    setPage(1)
    setSelected(undefined)
    setNotice(`${record.code} created successfully. Showing page 1 with your current filters; the new record may be hidden by those filters or appear on another page.`)
    state.retry()
  }
  function refreshRecipes() {
    setDetailRevision(value => value + 1)
    setHistoryRevision(value => value + 1)
    state.retry()
  }
  function recipeCreated(record: Recipe) {
    creationOpenedDetails.current = true
    selectionButton.current = null
    setPage(1)
    setSelected(record._id)
    setHistoryContext({ productId: record.productId, size: record.size })
    setHistoryOpen(true)
    refreshRecipes()
  }
  function openHistory(button: HTMLButtonElement, recipe?: Recipe) {
    historyOpener.current = button
    if (recipe) setHistoryContext({ productId: recipe.productId, size: recipe.size })
    setHistoryFocusRequest(value => value + 1)
    setHistoryOpen(true)
  }
  function closeHistory() {
    setHistoryOpen(false)
    if (historyOpener.current?.isConnected) historyOpener.current.focus()
    else historyButton.current?.focus()
  }
  function viewHistoryRecipe(id: string, button: HTMLButtonElement) {
    select(id, button)
    if (selected === id) setDetailRevision(value => value + 1)
  }
  function viewCreatedReference(id: string, close: () => void) {
    creationOpenedDetails.current = true
    selectionButton.current = null
    setSelected(id)
    setDetailRevision(value => value + 1)
    close()
  }
  function closeDetails() {
    setSelected(undefined)
    if (selectionButton.current?.isConnected) selectionButton.current.focus()
    else creationButton.current?.focus()
  }
  const action = creation ?? recipeCreation
  const title = titles[section]
  return <>
    <header className="workspace-heading"><div><p className="eyebrow">Catalog / {title}</p><h1>{title}</h1><p className="muted">{descriptions[section]}</p></div>{action && <button ref={creationButton} className="primary-button" type="button" onClick={action.open} disabled={action.busy}>New {section === 'ingredients' ? 'ingredient' : section === 'products' ? 'product' : 'recipe'}</button>}</header>
    {notice && <p className="creation-success" role="status">{notice}</p>}
    {creation && <CatalogCreation model={creation} onCreated={created} onRefreshed={state.retry} onViewExisting={id => viewCreatedReference(id, creation.close)} />}
    {recipeCreation?.success && <p className="creation-success" role="status">Recipe version {recipeCreation.success.version} created successfully. Created as Inactive. Your current filters may hide the new version or place it on another page.</p>}
    {recipeCreation && <RecipeCreation client={client} model={recipeCreation} onCreated={recipeCreated} onRefreshed={refreshRecipes} onViewRecipe={id => viewCreatedReference(id, recipeCreation.close)} />}
    {section === 'recipes' && <button ref={historyButton} type="button" aria-expanded={historyOpen} onClick={event => openHistory(event.currentTarget)}>Browse recipe history</button>}
    {section === 'recipes' && historyOpen && <RecipeHistory client={client} context={historyContext} revision={historyRevision} focusRequest={historyFocusRequest}
      onContextChange={setHistoryContext} onViewRecipe={viewHistoryRecipe} close={closeHistory} />}
    <div className={`catalog-layout ${selected ? 'with-details' : ''}`}>
      <section className="list-panel surface" aria-label={`${title} directory`}>
        <div className="panel-heading"><div><h2>{title} directory</h2><p className="muted">{data ? `${data.pagination.total} records matching your filters` : 'Browse your catalog'}</p></div></div>
        <FilterForm section={section} onApply={apply} />
        <div aria-busy={state.loading}>
          {state.loading && <div className="feedback" role="status"><span className="loading-dot" aria-hidden="true" />Loading {title.toLowerCase()}…</div>}
          {state.error && <ErrorState message={state.error} retry={state.retry} />}
          {data && (data.data.length === 0 ? <div className="feedback empty-state"><span aria-hidden="true">∅</span><h3>No {title.toLowerCase()} found</h3><p>Try changing or resetting your filters.</p></div> : <div className="table-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
            <table><caption className="sr-only">{title} catalog</caption><thead><tr>
              {section === 'recipes' ? <><th scope="col">Product</th><th scope="col">Size</th><th scope="col">Version</th><th scope="col">Ingredients & quantities</th><th scope="col">Status</th></> : <><th scope="col">Code / Name</th><th scope="col">Category</th>{section === 'ingredients' ? <><th scope="col">Unit</th><th scope="col">Cost price</th><th scope="col">Min. stock</th><th scope="col">Status</th></> : <><th scope="col">Size prices</th><th scope="col">Availability</th></>}</>}
              <th scope="col"><span className="sr-only">Details</span></th>
            </tr></thead><tbody>{data.data.map(item => <tr key={item._id} className={selected === item._id ? 'selected-row' : ''}>
              {'name' in item ? <><th scope="row"><span className="record-name">{item.name}</span><span className="record-code">{item.code}</span></th><td>{item.category}</td>{'costPrice' in item ? <><td>{item.unit}</td><td className="decimal">{item.costPrice}</td><td className="decimal">{item.minStock}</td><td><Status active={item.isActive} /></td></> : <><td><Prices product={item} /></td><td><Status active={item.isAvailable} available /></td></>}</>
                : <><th scope="row"><Reference kind="product" id={item.productId} reader={data.reader} /></th><td>{item.size}</td><td>v{item.version}</td><td><RecipeIngredients recipe={item} reader={data.reader} /></td><td><Status active={item.isActive} /></td></>}
              <td><button className="text-button" type="button" aria-label={'name' in item ? `View ${item.name}` : `View recipe ${item.size} version ${item.version} for ${item.productId}`} aria-pressed={selected === item._id} onClick={e => select(item._id, e.currentTarget)}>View <span aria-hidden="true">↗</span></button>
                {'ingredients' in item && <button className="text-button recipe-history-link" type="button" aria-label={`History for recipe ${item.size} version ${item.version} for ${item.productId}`} onClick={event => openHistory(event.currentTarget, item)}>History</button>}</td>
            </tr>)}</tbody></table>
          </div>)}
        </div>
        <footer className="pagination" aria-label="Pagination"><label>Rows per page<select value={limit} onChange={e => { setLimit(Number(e.target.value)); changePage(1) }}>{[10, 20, 50].map(value => <option key={value}>{value}</option>)}</select></label>
          <span aria-live="polite">{data ? `Page ${data.pagination.page} of ${data.pagination.totalPages || 1}` : `Page ${page}`}</span><div><button type="button" disabled={page <= 1 || state.loading} onClick={() => changePage(page - 1)}>Previous</button><button type="button" disabled={!data || page >= data.pagination.totalPages || state.loading} onClick={() => changePage(page + 1)}>Next</button></div>
        </footer>
      </section>
      {selected && reader && <DetailPanel key={`${selected}:${detailRevision}`} client={client} section={section} id={selected} reader={reader} close={closeDetails} />}
    </div>
  </>
}
export default function Catalog({ client }: { client: WorkspaceClient }) {
  const [section, setSection] = useState<Section>('ingredients')
  const ingredientCreation = useCatalogCreation('ingredients', client)
  const productCreation = useCatalogCreation('products', client)
  const recipeCreation = useRecipeCreation(client)
  const busy = ingredientCreation.busy || productCreation.busy || recipeCreation.busy
  return <div className="catalog-shell"><a className="skip-link" href="#catalog-main">Skip to catalog</a>
    <aside className="sidebar"><div className="brand"><span className="brand-mark" aria-hidden="true">W</span><div>WaveHouse<span>MANAGEMENT</span></div></div><p className="nav-label">Workspace</p>
      <nav aria-label="Catalog sections">{sections.map((item, index) => <button type="button" key={item} aria-current={section === item ? 'page' : undefined} disabled={busy} onClick={() => setSection(item)}><span className="nav-symbol" aria-hidden="true">{['◫', '◇', '≋'][index]}</span>{titles[item]}</button>)}</nav>
      <div className="sidebar-note"><span className="sidebar-note-dot" aria-hidden="true" /><strong>Catalog workspace</strong><p>Ingredients, products<br />and the recipes that connect them.</p></div>
    </aside>
    <div className="workspace"><div className="topbar"><span>Workspace <span aria-hidden="true">/</span> <strong>Catalog</strong></span><span className="workspace-label">WaveHouse Admin</span></div><main id="catalog-main" tabIndex={-1}><Workspace key={section} section={section} client={client} creation={section === 'ingredients' ? ingredientCreation : section === 'products' ? productCreation : undefined} recipeCreation={section === 'recipes' ? recipeCreation : undefined} /></main><footer className="workspace-footer">WaveHouse Management <span>Catalog · Browse &amp; create</span></footer></div>
  </div>
}
