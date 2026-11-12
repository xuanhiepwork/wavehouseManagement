import { useCallback, useId, useState } from 'react'
import type { CatalogClient, Ingredient, PageEnvelope, Product } from '../api/catalog'
import { useCatalogRead } from './useCatalogRead'

export type CatalogReferenceClient = {
  products: Pick<CatalogClient['products'], 'list'>
  ingredients: Pick<CatalogClient['ingredients'], 'list'>
}

interface SharedProps {
  client: CatalogReferenceClient
  selectedIds?: readonly string[]
  disabled?: boolean
  visible?: boolean
}

export type CatalogReferencePickerProps = SharedProps & (
  | { kind: 'product'; onSelect: (product: Product) => void }
  | { kind: 'ingredient'; onSelect: (ingredient: Ingredient) => void }
)

interface SelectionQuery {
  search: string
  available: boolean
  page: number
  limit: number
}

// Hiding or changing picker kind unmounts its read state; the parent owns selections and quantities.
export default function CatalogReferencePicker(props: CatalogReferencePickerProps) {
  return props.visible === false ? null : <ReferencePicker key={props.kind} {...props} />
}

function ReferencePicker(props: CatalogReferencePickerProps) {
  const { client, kind, disabled = false, selectedIds = [] } = props
  const id = useId()
  const plural = kind === 'product' ? 'products' : 'ingredients'
  const title = kind === 'product' ? 'Product selection' : 'Ingredient selection'
  const [search, setSearch] = useState('')
  const [available, setAvailable] = useState(true)
  const [query, setQuery] = useState<SelectionQuery>({ search: '', available: true, page: 1, limit: 10 })
  const load = useCallback(async (): Promise<PageEnvelope<Product | Ingredient>> => {
    const paging = { page: query.page, limit: query.limit, search: query.search || undefined }
    return kind === 'product'
      ? client.products.list({ ...paging, isAvailable: query.available })
      : client.ingredients.list({ ...paging, isActive: query.available })
  }, [client, kind, query])
  const state = useCatalogRead(load)
  const selected = new Set(selectedIds.map(value => value.toLowerCase()))

  function apply() {
    setQuery(previous => ({ ...previous, search: search.trim(), available, page: 1 }))
  }

  function select(item: Product | Ingredient) {
    if (disabled || selected.has(item._id.toLowerCase())) return
    if (props.kind === 'product' && 'prices' in item) props.onSelect(item)
    else if (props.kind === 'ingredient' && 'costPrice' in item) props.onSelect(item)
  }

  return <section className="reference-picker" aria-label={title}>
    <h3>{title}</h3>
    <fieldset disabled={disabled}>
      <legend className="sr-only">{title} filters and results</legend>
      <div className="reference-filters">
        <label htmlFor={`${id}-search`}>Search {plural}
          <input id={`${id}-search`} type="search" value={search} placeholder="Code or name"
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); apply() }
            }} />
        </label>
        <label htmlFor={`${id}-status`}>{kind === 'product' ? 'Product availability' : 'Ingredient status'}
          <select id={`${id}-status`} value={String(available)} onChange={event => setAvailable(event.target.value === 'true')}>
            <option value="true">{kind === 'product' ? 'Available (default)' : 'Active (default)'}</option>
            <option value="false">{kind === 'product' ? 'Unavailable' : 'Inactive'}</option>
          </select>
        </label>
        <button type="button" onClick={apply}>Apply {kind} filters</button>
      </div>
      {!query.available && <p className="reference-warning">
        {kind === 'product'
          ? 'Unavailable products can be used in an inactive recipe draft. This does not establish activation eligibility.'
          : 'Inactive ingredients can be used in an inactive recipe draft. This does not establish activation eligibility.'}
      </p>}
      <div aria-busy={state.loading}>
        {state.loading && <p className="feedback" role="status">Loading {plural} for selection…</p>}
        {state.error && <div className="feedback error-state" role="alert">
          <p>Unable to load {plural} for selection. {state.error}</p>
          <button type="button" onClick={state.retry}>Retry {plural} selection</button>
        </div>}
        {state.data && (state.data.data.length === 0
          ? <p className="feedback empty-state">No {plural} match these selection filters.</p>
          : <div className="table-scroll" role="region" aria-label={`${title} results`} tabIndex={0}>
            <table>
              <caption className="sr-only">{title} results</caption>
              <thead><tr><th scope="col">Code / Name</th><th scope="col">Category</th>
                <th scope="col">{kind === 'product' ? 'Supported sizes' : 'Unit'}</th>
                <th scope="col">{kind === 'product' ? 'Availability' : 'Status'}</th>
                <th scope="col"><span className="sr-only">Select {kind}</span></th></tr></thead>
              <tbody>{state.data.data.map(item => {
                const isSelected = selected.has(item._id.toLowerCase())
                const active = 'isAvailable' in item ? item.isAvailable : item.isActive
                return <tr key={item._id}>
                  <th scope="row"><span className="record-name">{item.name}</span><span className="record-code">{item.code}</span><code>{item._id}</code></th>
                  <td>{item.category}</td>
                  <td>{'prices' in item
                    ? (['S', 'M', 'L'] as const).filter(size => item.prices.some(price => price.size === size)).join(', ')
                    : item.unit}</td>
                  <td><span className={`status ${active ? 'positive' : 'neutral'}`}>
                    {kind === 'product' ? (active ? 'Available' : 'Unavailable') : (active ? 'Active' : 'Inactive')}
                  </span></td>
                  <td><button type="button" disabled={disabled || isSelected} aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Selected' : kind === 'product' ? 'Select' : 'Add'} ${item.name}`}
                    onClick={() => select(item)}>
                    {isSelected ? (kind === 'product' ? 'Selected' : 'Added') : kind === 'product' ? 'Select' : 'Add'}
                  </button></td>
                </tr>
              })}</tbody>
            </table>
          </div>)}
      </div>
      <footer className="pagination" aria-label={`${title} pagination`}>
        <label htmlFor={`${id}-limit`}>{kind === 'product' ? 'Products' : 'Ingredients'} per page
          <select id={`${id}-limit`} value={query.limit} onChange={event => {
            const limit = Number(event.target.value)
            setQuery(previous => ({ ...previous, page: 1, limit }))
          }}>
            {[10, 20, 50].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <span aria-live="polite">{state.data
          ? `Page ${state.data.pagination.page} of ${state.data.pagination.totalPages || 1}`
          : `Page ${query.page}`}</span>
        <div><button type="button" aria-label={`Previous ${plural} page`} disabled={disabled || query.page <= 1 || state.loading}
          onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}>Previous</button>
          <button type="button" aria-label={`Next ${plural} page`}
            disabled={disabled || !state.data || query.page >= state.data.pagination.totalPages || state.loading}
            onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Next</button></div>
      </footer>
    </fieldset>
  </section>
}
