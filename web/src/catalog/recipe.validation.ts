import type { ProductSize, Recipe, RecipeInput } from '../api/catalog'

export interface RecipeDraft {
  productId: string
  size: ProductSize | ''
  ingredients: { ingredientId: string; quantity: string }[]
}

export type RecipeFieldErrors = Record<string, string>

export function emptyRecipeDraft(): RecipeDraft {
  return { productId: '', size: '', ingredients: [] }
}

export function isRecipeUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
}

/** UUIDs are case-insensitive, but whitespace is never accepted as part of an ID. */
export function normalizeUuid(value: string): string {
  return value.toLowerCase()
}

function quantityError(value: string): string | undefined {
  if (!value) return 'Enter an Ingredient quantity.'
  if (value.length > 100 || !/^\d+(?:\.\d+)?$/.test(value)) {
    return 'Use an unsigned decimal without spaces, signs, or exponents.'
  }
  const [whole, fraction = ''] = value.split('.')
  if (whole.replace(/^0+(?=\d)/, '').length > 12 || fraction.length > 6) {
    return 'Use at most 12 whole digits and 6 decimal places, including trailing zeros.'
  }
  if (!/[1-9]/.test(whole + fraction)) return 'Quantity must be greater than zero.'
}

/** Normalize only valid positive numeric(18,6) text, without floating-point conversion. */
export function normalizeRecipeQuantity(value: string): string | undefined {
  if (quantityError(value)) return undefined
  const [whole, fraction = ''] = value.split('.')
  const integer = whole.replace(/^0+(?=\d)/, '')
  const fractional = fraction.replace(/0+$/, '')
  return integer + (fractional ? `.${fractional}` : '')
}

export function validateRecipeCreation(draft: RecipeDraft): {
  errors: RecipeFieldErrors
  payload?: RecipeInput
} {
  const errors: RecipeFieldErrors = {}
  if (!isRecipeUuid(draft.productId)) errors.productId = 'Choose a Product with a valid UUID.'
  if (!['S', 'M', 'L'].includes(draft.size)) errors.size = 'Choose a supported Product size.'
  if (!draft.ingredients.length) errors.ingredients = 'Add at least one Ingredient.'

  const seen = new Set<string>()
  draft.ingredients.forEach((entry, index) => {
    if (!isRecipeUuid(entry.ingredientId)) {
      errors[`ingredientId${index}`] = 'Choose an Ingredient with a valid UUID.'
    } else {
      const id = normalizeUuid(entry.ingredientId)
      if (seen.has(id)) errors[`ingredientId${index}`] = 'Each Ingredient may appear only once.'
      seen.add(id)
    }
    const error = quantityError(entry.quantity)
    if (error) errors[`quantity${index}`] = error
  })

  if (Object.keys(errors).length) return { errors }
  return {
    errors,
    payload: {
      productId: draft.productId,
      size: draft.size as ProductSize,
      ingredients: draft.ingredients.map(({ ingredientId, quantity }) => ({ ingredientId, quantity })),
    },
  }
}

/** A possible history match is evidence to review, never proof that a POST succeeded. */
export function recipeMatchesPayload(recipe: Recipe, payload: RecipeInput): boolean {
  if (!isRecipeUuid(recipe.productId) || !isRecipeUuid(payload.productId)
    || normalizeUuid(recipe.productId) !== normalizeUuid(payload.productId)
    || recipe.size !== payload.size
    || !['S', 'M', 'L'].includes(payload.size)
    || !payload.ingredients.length
    || recipe.ingredients.length !== payload.ingredients.length) return false

  const requested = new Map<string, string>()
  for (const entry of payload.ingredients) {
    if (!isRecipeUuid(entry.ingredientId)) return false
    const id = normalizeUuid(entry.ingredientId)
    const quantity = normalizeRecipeQuantity(entry.quantity)
    if (!quantity || requested.has(id)) return false
    requested.set(id, quantity)
  }

  const observed = new Set<string>()
  for (const entry of recipe.ingredients) {
    if (!isRecipeUuid(entry.ingredientId)) return false
    const id = normalizeUuid(entry.ingredientId)
    const quantity = normalizeRecipeQuantity(entry.quantity)
    if (!quantity || observed.has(id) || requested.get(id) !== quantity) return false
    observed.add(id)
  }
  return true
}
