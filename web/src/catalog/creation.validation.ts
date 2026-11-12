import type { BaseUnit, IngredientInput, ProductInput, ProductPrice } from '../api/catalog'

export type CreationKind = 'ingredients' | 'products'
export interface CreationDraft {
  code: string
  name: string
  category: string
  unit: BaseUnit | ''
  costPrice: string
  minStock: string
  isActive: boolean
  description: string
  imageUrl: string
  isAvailable: boolean
  prices: ProductPrice[]
}
export type FieldErrors = Record<string, string>
export type CreationPayload = { kind: 'ingredients'; input: IngredientInput } | { kind: 'products'; input: ProductInput }

export function emptyCreationDraft(): CreationDraft {
  return { code: '', name: '', category: '', unit: '', costPrice: '', minStock: '', isActive: true,
    description: '', imageUrl: '', isAvailable: true, prices: [{ size: 'S', price: '' }] }
}

/** Match PostgreSQL numeric(18, scale) input checks, keeping every digit as text. */
function decimalError(value: string, scale: number): string | undefined {
  if (!value) return 'Enter a decimal value.'
  if (value.length > 100 || !/^\d+(?:\.\d+)?$/.test(value)) return 'Use an unsigned decimal without spaces, signs, or exponents.'
  const [whole, fraction = ''] = value.split('.')
  if (whole.replace(/^0+(?=\d)/, '').length > 18 - scale || fraction.length > scale) {
    return `Use at most ${18 - scale} whole digits and ${scale} decimal places, including trailing zeros.`
  }
}

export function validateCreation(kind: CreationKind, draft: CreationDraft): { payload?: CreationPayload; errors: FieldErrors } {
  const errors: FieldErrors = {}
  const code = draft.code.trim().toUpperCase(), name = draft.name.trim(), category = draft.category.trim()
  for (const [key, value, raw, limit] of [
    ['code', code, draft.code, 64], ['name', name, draft.name, 200], ['category', category, draft.category, 100],
  ] as const) {
    if (!value) errors[key] = 'This field is required.'
    else if (raw.includes('\0')) errors[key] = 'Null characters are not allowed.'
    else if ([...value].length > limit) errors[key] = `Use at most ${limit} characters after normalization.`
  }
  const checkDecimal = (field: string, value: string, scale: number) => {
    const error = decimalError(value, scale)
    if (error) errors[field] = error
  }
  if (kind === 'ingredients') {
    if (!['g', 'ml', 'piece'].includes(draft.unit)) errors.unit = 'Choose g, ml, or piece.'
    checkDecimal('costPrice', draft.costPrice, 4)
    if (draft.minStock !== '') checkDecimal('minStock', draft.minStock, 6)
    if (Object.keys(errors).length) return { errors }
    return { errors, payload: { kind, input: { code, name, category, unit: draft.unit as BaseUnit,
      costPrice: draft.costPrice, ...(draft.minStock === '' ? {} : { minStock: draft.minStock }), isActive: draft.isActive } } }
  }
  for (const key of ['description', 'imageUrl'] as const) {
    if (draft[key].includes('\0')) errors[key] = 'Null characters are not allowed.'
  }
  if (draft.prices.length < 1 || draft.prices.length > 3) errors.prices = 'Provide one to three distinct size prices.'
  const sizes = new Set<string>()
  draft.prices.forEach((entry, index) => {
    if (!['S', 'M', 'L'].includes(entry.size)) errors[`size${index}`] = 'Choose S, M, or L.'
    else if (sizes.has(entry.size)) errors[`size${index}`] = 'Each size may appear only once.'
    sizes.add(entry.size)
    checkDecimal(`price${index}`, entry.price, 4)
  })
  if (Object.keys(errors).length) return { errors }
  const description = draft.description.trim(), imageUrl = draft.imageUrl.trim()
  return { errors, payload: { kind, input: { code, name, category, isAvailable: draft.isAvailable,
    ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}),
    prices: (['S', 'M', 'L'] as const).flatMap(size => draft.prices.filter(entry => entry.size === size).map(entry => ({ ...entry }))),
  } } }
}
