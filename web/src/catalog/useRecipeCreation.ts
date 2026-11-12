import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogApiError } from '../api/catalog'
import type { CatalogClient, Ingredient, Product, ProductSize, Recipe, RecipeInput } from '../api/catalog'
import { useCatalogRead } from './useCatalogRead'
import { emptyRecipeDraft, normalizeUuid, recipeMatchesPayload, validateRecipeCreation } from './recipe.validation'
import type { RecipeFieldErrors } from './recipe.validation'
import type { RecipeMutationLock } from './useRecipeLifecycle'

export type RecipeCreationClient = {
  products: Pick<CatalogClient['products'], 'list' | 'detail'>
  ingredients: Pick<CatalogClient['ingredients'], 'list' | 'detail'>
  recipes: Pick<CatalogClient['recipes'], 'list' | 'create'>
}
type Phase = 'editing' | 'preflight' | 'saving' | 'uncertain' | 'checking' | 'reviewed'
interface Attempt { payload: RecipeInput; observed: Recipe[] }
function safeMessage(error: unknown) {
  return error instanceof CatalogApiError ? error.message : 'The recipe operation could not be confirmed. Please review server state.'
}

/** Complete, unfiltered-by-status history for one Product/size; never stop at the first match. */
async function readHistory(client: RecipeCreationClient, payload: RecipeInput) {
  const rows: Recipe[] = [], ids = new Set<string>()
  let total: number | undefined
  for (let page = 1; ; page++) {
    const result = await client.recipes.list({ productId: normalizeUuid(payload.productId), size: payload.size, page, limit: 100 })
    if (result.pagination.page !== page || (total !== undefined && total !== result.pagination.total)) {
      throw new CatalogApiError('MALFORMED_RESPONSE')
    }
    total = result.pagination.total
    for (const row of result.data) {
      const id = normalizeUuid(row._id)
      if (normalizeUuid(row.productId) !== normalizeUuid(payload.productId) || row.size !== payload.size || ids.has(id)) {
        throw new CatalogApiError('MALFORMED_RESPONSE')
      }
      ids.add(id); rows.push(row)
    }
    if (page >= result.pagination.totalPages) break
  }
  if (rows.length !== total) throw new CatalogApiError('MALFORMED_RESPONSE')
  return rows
}

/** Lives above the keyed workspace: closing/navigating never discards a draft or unknown outcome. */
export function useRecipeCreation(client: RecipeCreationClient, mutationLock?: RecipeMutationLock) {
  const [draft, setDraft] = useState(emptyRecipeDraft)
  const [errors, setErrors] = useState<RecipeFieldErrors>({})
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('editing')
  const [message, setMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [attempt, setAttempt] = useState<Attempt>()
  const [review, setReview] = useState<Recipe[]>()
  const [success, setSuccess] = useState<Recipe>()
  const gate = useRef<Phase>('editing')
  const attempted = useRef<Attempt | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const setGate = (value: Phase) => { gate.current = value; setPhase(value) }
  const busy = phase === 'preflight' || phase === 'saving' || phase === 'checking' || mutationLock?.owner === 'lifecycle'
  const locked = () => ['preflight', 'saving', 'checking'].includes(gate.current) || mutationLock?.current.current === 'lifecycle'
  const loadProduct = useCallback(async () => draft.productId ? (await client.products.detail(draft.productId)).data : undefined, [client, draft.productId])
  const productRead = useCatalogRead(loadProduct)
  const ingredientIds = draft.ingredients.map(entry => entry.ingredientId).join(',')
  const loadIngredients = useCallback(async () => ingredientIds
    ? Promise.all(ingredientIds.split(',').map(async id => (await client.ingredients.detail(id)).data)) : [], [client, ingredientIds])
  const ingredientsRead = useCatalogRead(loadIngredients)

  function changed() { setAcknowledged(false); setErrors({}) }
  function selectProduct(product: Product) {
    if (locked()) return
    setDraft(previous => ({ ...previous, productId: normalizeUuid(product._id), size: '' }))
    changed()
  }
  function selectSize(size: ProductSize | '') {
    if (locked()) return
    setDraft(previous => ({ ...previous, size })); changed()
  }
  function addIngredient(ingredient: Ingredient) {
    if (locked()) return
    const id = normalizeUuid(ingredient._id)
    setDraft(previous => previous.ingredients.some(row => normalizeUuid(row.ingredientId) === id) ? previous
      : { ...previous, ingredients: [...previous.ingredients, { ingredientId: id, quantity: '' }] })
    changed()
  }
  function quantity(index: number, value: string) {
    if (locked()) return
    setDraft(previous => ({ ...previous, ingredients: previous.ingredients.map((row, i) => i === index ? { ...row, quantity: value } : row) })); changed()
  }
  function removeIngredient(index: number) {
    if (locked()) return
    setDraft(previous => ({ ...previous, ingredients: previous.ingredients.filter((_, i) => i !== index) })); changed()
  }
  async function submit(onCreated: (recipe: Recipe) => void) {
    if (locked() || gate.current === 'uncertain' || (gate.current === 'reviewed' && !acknowledged)) return
    const validated = validateRecipeCreation(draft)
    setErrors(validated.errors)
    if (!validated.payload) return
    if (mutationLock && !mutationLock.acquire('creation')) return
    const payload = validated.payload
    const previousAttempt = attempted.current
    setGate('preflight') // Synchronous, before the first await or POST.
    setMessage(''); setAcknowledged(false)
    let observed: Recipe[]
    try {
      const [product, ingredients, history] = await Promise.all([
        client.products.detail(payload.productId).then(result => result.data),
        Promise.all(payload.ingredients.map(async row => (await client.ingredients.detail(row.ingredientId)).data)),
        readHistory(client, payload),
      ])
      if (!mounted.current) return
      if (normalizeUuid(product._id) !== normalizeUuid(payload.productId)
        || ingredients.some((row, i) => normalizeUuid(row._id) !== normalizeUuid(payload.ingredients[i].ingredientId))) {
        throw new CatalogApiError('MALFORMED_RESPONSE')
      }
      if (!product.prices.some(row => row.size === payload.size)) {
        setErrors({ size: 'This Product no longer supports the selected size. Choose a current size.' })
        productRead.retry(); setGate(previousAttempt ? 'uncertain' : 'editing')
        if (!previousAttempt) mutationLock?.release('creation')
        return
      }
      observed = history
      productRead.retry(); ingredientsRead.retry()
    } catch (error) {
      if (!mounted.current) return
      setMessage(`Preflight failed. No creation request was sent. ${safeMessage(error)}`)
      // A failed resubmission preflight must not bypass the previous uncertainty gate.
      setGate(attempted.current ? 'uncertain' : 'editing')
      if (!attempted.current) mutationLock?.release('creation')
      return
    }
    const currentAttempt = { payload, observed }
    attempted.current = currentAttempt; setAttempt(currentAttempt); setReview(undefined)
    setGate('saving')
    let record: Recipe
    try {
      record = (await client.recipes.create(payload)).data
      if (!recipeMatchesPayload(record, payload) || record.isActive
        || observed.some(row => normalizeUuid(row._id) === normalizeUuid(record._id))
        || record.version <= observed.reduce((maximum, row) => Math.max(maximum, row.version), 0)) {
        throw new CatalogApiError('MALFORMED_RESPONSE')
      }
    } catch (error) {
      if (!mounted.current) return
      const rejected = error instanceof CatalogApiError && ['BAD_REQUEST', 'CONFLICT', 'NOT_FOUND', 'CONFIGURATION'].includes(error.code)
      setMessage(safeMessage(error))
      if (rejected) { attempted.current = previousAttempt; setAttempt(previousAttempt) }
      setGate(rejected && !previousAttempt ? 'editing' : 'uncertain')
      if (rejected && !previousAttempt) mutationLock?.release('creation')
      return
    }
    if (!mounted.current) return
    setDraft(emptyRecipeDraft()); setErrors({}); setMessage(''); setReview(undefined)
    attempted.current = undefined; setAttempt(undefined); setSuccess(record)
    setVisible(false); setGate('editing')
    mutationLock?.release('creation')
    onCreated(record)
  }
  async function refreshServerState(onRefreshed: () => void) {
    if (!attempted.current || !['uncertain', 'reviewed'].includes(gate.current)) return
    if (mutationLock && !mutationLock.acquire('creation')) return
    const currentAttempt = attempted.current
    setGate('checking'); setAcknowledged(false); setMessage(''); setReview(undefined)
    try {
      const history = await readHistory(client, currentAttempt.payload)
      if (!mounted.current) return
      setReview(history); setGate('reviewed'); mutationLock?.release('creation'); onRefreshed()
    } catch (error) {
      if (!mounted.current) return
      setMessage(`Server state could not be fully reviewed. ${safeMessage(error)}`)
      setGate('uncertain')
    }
  }
  return { draft, errors, visible, phase, message, acknowledged, attempt, review, success, busy,
    canSubmit: !busy && phase !== 'uncertain' && (phase !== 'reviewed' || acknowledged),
    productRead, ingredientsRead, selectProduct, selectSize, addIngredient, quantity, removeIngredient,
    open: () => { if (!locked()) setVisible(true) }, close: () => { if (!locked()) setVisible(false) },
    acknowledge: (value: boolean) => { if (gate.current === 'reviewed') setAcknowledged(value) }, submit, refreshServerState }
}
export type RecipeCreationModel = ReturnType<typeof useRecipeCreation>
