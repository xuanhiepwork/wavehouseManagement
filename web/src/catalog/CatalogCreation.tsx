import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ProductSize } from '../api/catalog'
import type { CatalogCreationModel } from './useCatalogCreation'
import type { Ingredient, Product } from '../api/catalog'
import './CatalogCreation.css'

export default function CatalogCreation({ model, onCreated, onRefreshed, onViewExisting }: {
  model: CatalogCreationModel
  onCreated: (record: Ingredient | Product) => void
  onRefreshed: () => void
  onViewExisting: (id: string) => void
}) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const { draft, change, errors } = model
  const title = model.kind === 'ingredients' ? 'ingredient' : 'product'
  useEffect(() => {
    if (model.visible && Object.keys(errors).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors, model.visible])
  useEffect(() => {
    if (model.visible) form.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [model.visible])
  if (!model.visible) return null
  function field(key: string, label: string, control: ReactNode, hint?: string) {
    return <div className="creation-field"><label htmlFor={`${id}-${key}`}>{label}</label>{control}
      {hint && <span id={`${id}-${key}-hint`} className="field-hint">{hint}</span>}
      {errors[key] && <span id={`${id}-${key}-error`} className="field-error">{errors[key]}</span>}
    </div>
  }
  function attrs(key: string, hint = false) {
    return { id: `${id}-${key}`, 'aria-invalid': errors[key] ? true : undefined,
      'aria-describedby': [hint && `${id}-${key}-hint`, errors[key] && `${id}-${key}-error`].filter(Boolean).join(' ') || undefined }
  }
  const uncertain = model.phase === 'uncertain' || model.phase === 'checking' || model.phase === 'reviewed'
  return <section className="surface creation-panel" aria-label={`New ${title}`}>
    <div className="panel-heading"><div><h2>Create {title}</h2><p className="muted">Your draft is kept when you close this form or switch sections.</p></div>
      <button type="button" aria-label="Close creation form" disabled={model.busy} onClick={model.close}>Close</button></div>
    <form ref={form} aria-label={`Create ${title}`} aria-busy={model.busy} noValidate onSubmit={event => { event.preventDefault(); void model.submit(onCreated) }}>
      <fieldset disabled={model.busy} className="creation-fields"><legend className="sr-only">{title} fields</legend>
        {field('code', 'Code', <input {...attrs('code')} required autoComplete="off" value={draft.code} onChange={e => change('code', e.target.value)} />)}
        {field('name', 'Name', <input {...attrs('name')} required value={draft.name} onChange={e => change('name', e.target.value)} />)}
        {field('category', 'Category', <input {...attrs('category')} required value={draft.category} onChange={e => change('category', e.target.value)} />)}
        {model.kind === 'ingredients' ? <>
          {field('unit', 'Unit', <select {...attrs('unit')} required value={draft.unit} onChange={e => change('unit', e.target.value as typeof draft.unit)}><option value="">Choose a unit</option><option value="g">g</option><option value="ml">ml</option><option value="piece">piece</option></select>)}
          {field('costPrice', 'Cost price', <input {...attrs('costPrice', true)} required type="text" inputMode="decimal" value={draft.costPrice} onChange={e => change('costPrice', e.target.value)} />, 'Up to 14 whole digits and 4 decimal places.')}
          {field('minStock', 'Minimum stock', <input {...attrs('minStock', true)} type="text" inputMode="decimal" value={draft.minStock} onChange={e => change('minStock', e.target.value)} />, 'Optional; defaults to 0. Up to 12 whole digits and 6 decimal places.')}
          <label className="creation-checkbox"><input type="checkbox" checked={draft.isActive} onChange={e => change('isActive', e.target.checked)} />Active</label>
        </> : <>
          {field('description', 'Description', <textarea {...attrs('description')} value={draft.description} onChange={e => change('description', e.target.value)} />)}
          {field('imageUrl', 'Image URL', <input {...attrs('imageUrl', true)} type="text" value={draft.imageUrl} onChange={e => change('imageUrl', e.target.value)} />, 'Optional image reference; blank values are omitted.')}
          <label className="creation-checkbox"><input type="checkbox" checked={draft.isAvailable} onChange={e => change('isAvailable', e.target.checked)} />Available</label>
          <fieldset className="price-editor"><legend>Size prices</legend><p className="field-hint">Choose one to three distinct sizes. Prices allow up to 14 whole digits and 4 decimal places.</p>
            {errors.prices && <p className="field-error">{errors.prices}</p>}
            {draft.prices.map((entry, index) => <div className="price-editor-row" key={index}>
              {field(`size${index}`, `Size ${index + 1}`, <select {...attrs(`size${index}`)} value={entry.size} onChange={e => change('prices', draft.prices.map((price, i) => i === index ? { ...price, size: e.target.value as ProductSize } : price))}>{(['S', 'M', 'L'] as const).map(size => <option key={size} value={size} disabled={draft.prices.some((p, i) => i !== index && p.size === size)}>{size}</option>)}</select>)}
              {field(`price${index}`, `Price ${index + 1}`, <input {...attrs(`price${index}`)} required type="text" inputMode="decimal" value={entry.price} onChange={e => change('prices', draft.prices.map((price, i) => i === index ? { ...price, price: e.target.value } : price))} />)}
              <button type="button" disabled={draft.prices.length === 1} onClick={() => change('prices', draft.prices.filter((_, i) => i !== index))} aria-label={`Remove price ${index + 1}`}>Remove</button>
            </div>)}
            <button type="button" disabled={draft.prices.length >= 3} onClick={() => { const size = (['S', 'M', 'L'] as const).find(value => !draft.prices.some(price => price.size === value)); if (size) change('prices', [...draft.prices, { size, price: '' }]) }}>Add size price</button>
          </fieldset>
        </>}
      </fieldset>
      {Object.keys(errors).length > 0 && <p className="creation-feedback" role="alert">Check the highlighted fields.</p>}
      {model.message && <p className="creation-feedback" role="alert">{model.message}</p>}
      {uncertain && <div className="creation-feedback outcome-check" role="status">
        <p>Creation outcome is unknown. The record may have been saved. Refresh server state before deciding whether to submit again.</p>
        {model.phase === 'reviewed' && <>
          <p>{model.existing ? `A record with code ${model.existing.code} exists. Review it before creating another record; use a different code to create another.` : `No exact code match was found for ${model.attemptedCode}. This does not prove the earlier request was rolled back.`}</p>
          {model.existing && <button type="button" onClick={() => onViewExisting(model.existing!._id)}>View existing record</button>}
          <label className="creation-checkbox"><input type="checkbox" checked={model.acknowledged} onChange={e => model.acknowledge(e.target.checked)} />I reviewed the refreshed catalog and want to submit again.</label>
        </>}
        <button type="button" disabled={model.busy} onClick={() => void model.refreshServerState(onRefreshed)}>{model.phase === 'checking' ? 'Checking server state...' : 'Refresh server state'}</button>
      </div>}
      <div className="creation-actions"><button className="primary-button" type="submit" disabled={!model.canSubmit}>{model.phase === 'saving' ? 'Creating...' : model.phase === 'reviewed' ? 'Submit again' : `Create ${title}`}</button>
        <span className="field-hint">{model.phase === 'saving' ? 'Waiting for confirmation. Do not submit again.' : model.kind === 'ingredients' ? 'Required: code, name, category, unit and cost price.' : 'Required: code, name, category and all chosen size prices.'}</span>
      </div>
    </form>
  </section>
}
