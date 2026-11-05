import { useEffect, useId, useRef } from 'react'
import type { Recipe } from '../api/catalog'
import CatalogReferencePicker from './CatalogReferencePicker'
import type { RecipeCreationClient, RecipeCreationModel } from './useRecipeCreation'
import { normalizeUuid, recipeMatchesPayload } from './recipe.validation'
import './RecipeLifecycle.css'

export default function RecipeCreation({ client, model, onCreated, onRefreshed, onViewRecipe }: {
  client: RecipeCreationClient
  model: RecipeCreationModel
  onCreated: (recipe: Recipe) => void
  onRefreshed: () => void
  onViewRecipe: (id: string) => void
}) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const { draft, errors, busy, productRead, ingredientsRead } = model
  useEffect(() => { if (model.visible) heading.current?.focus() }, [model.visible])
  useEffect(() => {
    if (model.visible && Object.keys(errors).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [model.visible, errors])
  if (!model.visible) return null
  const product = productRead.data
  const sizes = (['S', 'M', 'L'] as const).filter(size => product?.prices.some(price => price.size === size))
  const uncertain = ['uncertain', 'checking', 'reviewed'].includes(model.phase)
  const matches = model.attempt && model.review?.filter(recipe => recipeMatchesPayload(recipe, model.attempt!.payload))
  function attrs(key: string) {
    return { id: `${id}-${key}`, 'aria-invalid': errors[key] ? true : undefined,
      'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined }
  }
  function error(key: string) { return errors[key] ? <p className="field-error" id={`${id}-${key}-error`}>{errors[key]}</p> : null }
  return <section className="surface recipe-creation" aria-label="New recipe">
    <div className="panel-heading"><div><h2 tabIndex={-1} ref={heading}>Create recipe</h2>
      <p className="muted">Creates a new inactive version. Your draft is kept when you close or switch sections.</p></div>
      <button type="button" disabled={busy} onClick={model.close} aria-label="Close recipe form">Close</button></div>
    <form ref={form} noValidate aria-label="Create recipe" aria-busy={busy}
      onSubmit={event => { event.preventDefault(); void model.submit(onCreated) }}>
      <fieldset className="recipe-fields" disabled={busy}><legend className="sr-only">Recipe draft</legend>
        <CatalogReferencePicker kind="product" client={client} selectedIds={[draft.productId]} onSelect={model.selectProduct} disabled={busy} />
        <section className="recipe-product" aria-label="Selected Product">
          <h3>Selected Product</h3>
          <label htmlFor={`${id}-productId`}>Selected Product UUID</label>
          <input {...attrs('productId')} readOnly value={draft.productId} placeholder="Select a Product above" />{error('productId')}
          {draft.productId && productRead.loading && <p role="status">Loading selected Product details...</p>}
          {productRead.error && <div role="alert"><p>{productRead.error}</p><button type="button" onClick={productRead.retry}>Retry selected Product</button></div>}
          {product && <><p><strong>{product.name}</strong> · {product.code} · {product.isAvailable ? 'Available' : 'Unavailable'}</p>
            {!product.isAvailable && <p className="reference-warning">This Product is unavailable. It can be used in an inactive Recipe; activation eligibility is not established.</p>}</>}
          <label htmlFor={`${id}-size`}>Recipe size</label>
          <select {...attrs('size')} value={draft.size} disabled={busy || !product || productRead.loading}
            onChange={event => model.selectSize(event.target.value as typeof draft.size)}>
            <option value="">Choose a supported size</option>{sizes.map(size => <option key={size}>{size}</option>)}
          </select>{error('size')}
          <p className="field-hint">Sizes come from Product details. Changing Product clears size and keeps Ingredient quantities.</p>
        </section>
        <CatalogReferencePicker kind="ingredient" client={client} selectedIds={draft.ingredients.map(row => row.ingredientId)} onSelect={model.addIngredient} disabled={busy} />
        <section className="recipe-selected" aria-label="Selected Ingredients">
          <h3>Selected Ingredients &amp; quantities</h3>
          {errors.ingredients && <p className="field-error" role="alert">{errors.ingredients}</p>}
          {!draft.ingredients.length && <p className="muted">Add at least one Ingredient from the selection above.</p>}
          {draft.ingredients.length > 0 && ingredientsRead.loading && <p role="status">Loading selected Ingredient details...</p>}
          {ingredientsRead.error && <div role="alert"><p>{ingredientsRead.error}</p><button type="button" onClick={ingredientsRead.retry}>Retry selected Ingredients</button></div>}
          {draft.ingredients.map((entry, index) => {
            const ingredient = ingredientsRead.data?.find(row => normalizeUuid(row._id) === normalizeUuid(entry.ingredientId))
            return <fieldset className="recipe-selected-row" key={entry.ingredientId}>
              <legend>Ingredient {index + 1}</legend>
              <div className="recipe-reference-summary"><strong>{ingredient?.name ?? 'Ingredient details pending'}</strong>
                {ingredient && <span>{ingredient.code} · Unit: {ingredient.unit} · {ingredient.isActive ? 'Active' : 'Inactive'}</span>}
                <code>{entry.ingredientId}</code>{error(`ingredientId${index}`)}
                {ingredient && !ingredient.isActive && <p className="reference-warning">This Ingredient is inactive. This draft does not establish activation eligibility.</p>}
              </div>
              <div className="creation-field"><label htmlFor={`${id}-quantity${index}`}>Quantity {index + 1}</label>
                <input {...attrs(`quantity${index}`)} required type="text" inputMode="decimal" value={entry.quantity}
                  onChange={event => model.quantity(index, event.target.value)} />
                {error(`quantity${index}`)}<span className="field-hint">Greater than zero; up to 12 whole digits and 6 decimal places, including trailing zeros.</span></div>
              <button type="button" aria-label={`Remove Ingredient ${index + 1}`} onClick={() => model.removeIngredient(index)}>Remove</button>
            </fieldset>
          })}
        </section>
      </fieldset>
      {Object.keys(errors).length > 0 && <p className="creation-feedback" role="alert">Check the highlighted Recipe fields.</p>}
      {model.message && <p className="creation-feedback" role="alert">{model.message}</p>}
      {uncertain && model.attempt && <section className="creation-feedback outcome-check" aria-label="Recipe outcome review" role="status">
        <h3>Creation outcome is unknown</h3><p>The Recipe may have been saved. Refresh server state before deciding whether to submit again.</p>
        <p>Attempted Product <code>{model.attempt.payload.productId}</code>, size {model.attempt.payload.size}. Observed before submission: {model.attempt.observed.length} versions
          {model.attempt.observed.length > 0 && ` (${model.attempt.observed.map(row => `v${row.version}`).join(', ')})`}.</p>
        <details><summary>Attempted Ingredient quantities</summary><ul>{model.attempt.payload.ingredients.map(row => <li key={row.ingredientId}><code>{row.ingredientId}</code>: <span className="decimal">{row.quantity}</span></li>)}</ul></details>
        {model.phase === 'reviewed' && <>
          <p>Reviewed {model.review?.length} versions across all history pages, including active and inactive Recipes.</p>
          {matches?.length ? <><p>Possible matching versions. A match does not prove this request created it.</p>
            <ul className="recipe-match-list">{matches.map(recipe => <li key={recipe._id}>
              <span>v{recipe.version} · {recipe.isActive ? 'Active' : 'Inactive'} · {model.attempt!.observed.some(row => normalizeUuid(row._id) === normalizeUuid(recipe._id)) ? 'Observed before submission' : 'Not observed before submission'}</span>
              <code>{recipe._id}</code><button type="button" onClick={() => onViewRecipe(recipe._id)}>View possible version {recipe.version}</button>
            </li>)}</ul></> : <p>No exact quantity/reference match was found. Absence does not prove the request was rolled back.</p>}
          <label className="creation-checkbox"><input type="checkbox" checked={model.acknowledged} onChange={event => model.acknowledge(event.target.checked)} />I reviewed server state and understand resubmission may create an additional version.</label>
        </>}
        <button type="button" disabled={busy} onClick={() => void model.refreshServerState(onRefreshed)}>{model.phase === 'checking' ? 'Reviewing server state...' : 'Refresh Recipe server state'}</button>
      </section>}
      <div className="creation-actions"><button className="primary-button" type="submit" disabled={!model.canSubmit}>
        {model.phase === 'preflight' ? 'Checking references...' : model.phase === 'saving' ? 'Creating recipe...' : model.phase === 'reviewed' ? 'Submit recipe again' : 'Create recipe'}
      </button><span className="field-hint">{busy ? 'Wait for confirmation. Do not submit again.' : 'The server assigns a new version and creates it inactive. No automatic activation.'}</span></div>
    </form>
  </section>
}
