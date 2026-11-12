import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogApiError } from '../api/catalog'
import type { CatalogClient, Ingredient, Product, Recipe } from '../api/catalog'

type Owner = 'creation' | 'lifecycle'
/** A shared synchronous gate; React state also makes the owner visible to controls. */
export function useRecipeMutationLock() {
  const current = useRef<Owner | undefined>(undefined)
  const [owner, setOwner] = useState<Owner>()
  const acquire = useCallback((next: Owner) => {
    if (current.current && current.current !== next) return false
    current.current = next; setOwner(next); return true
  }, [])
  const release = useCallback((previous: Owner) => {
    if (current.current === previous) { current.current = undefined; setOwner(undefined) }
  }, [])
  return { current, owner, acquire, release }
}
export type RecipeMutationLock = ReturnType<typeof useRecipeMutationLock>
export type RecipeLifecycleAction = 'activate' | 'deactivate'
export type RecipeLifecycleClient = {
  recipes: Pick<CatalogClient['recipes'], 'detail' | 'list' | 'activate' | 'deactivate'>
  products: Pick<CatalogClient['products'], 'detail'>
  ingredients: Pick<CatalogClient['ingredients'], 'detail'>
}
type Selection = { action: RecipeLifecycleAction; target: Recipe }
export interface RecipeLifecycleSnapshot {
  target: Recipe; active: Recipe | null; history: Recipe[]
  product?: Product; ingredients: Ingredient[]; issues: string[]; referenceErrors: string[]
}
type Phase = 'idle' | 'checking' | 'ready' | 'blocked' | 'rechecking' | 'saving'
  | 'uncertain' | 'reconciling' | 'confirmed' | 'reconciled' | 'rejected'
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const safeMessage = (error: unknown) => error instanceof CatalogApiError ? error.message : 'Server state could not be verified. Please refresh.'
const malformed = () => { throw new CatalogApiError('MALFORMED_RESPONSE') }

// Compare semantic records, independent of JSON property and Ingredient membership order.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function contents(recipe: Recipe) {
  return { id: recipe._id.toLowerCase(), productId: recipe.productId.toLowerCase(), size: recipe.size,
    version: recipe.version, createdAt: recipe.createdAt,
    ingredients: recipe.ingredients.map(row => ({ ingredientId: row.ingredientId.toLowerCase(), quantity: row.quantity }))
      .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)) }
}
function sameContents(a: Recipe, b: Recipe) { return stable(contents(a)) === stable(contents(b)) }
function assertContext(recipe: Recipe, target: Recipe) {
  if (!sameId(recipe.productId, target.productId) || recipe.size !== target.size) malformed()
}
async function readHistory(client: RecipeLifecycleClient, target: Recipe) {
  const rows: Recipe[] = [], ids = new Set<string>(), versions = new Set<number>()
  let total: number | undefined
  for (let page = 1; ; page++) {
    const result = await client.recipes.list({ productId: target.productId, size: target.size, page, limit: 100 })
    if (result.pagination.page !== page || result.pagination.limit !== 100
      || (total !== undefined && total !== result.pagination.total)) malformed()
    total = result.pagination.total
    if (result.data.length !== Math.min(100, Math.max(0, total - (page - 1) * 100))) malformed()
    for (const row of result.data) {
      assertContext(row, target)
      if (ids.has(row._id.toLowerCase()) || versions.has(row.version)) malformed()
      ids.add(row._id.toLowerCase()); versions.add(row.version); rows.push(row)
    }
    if (page >= result.pagination.totalPages) break
  }
  return rows
}
async function readSnapshot(client: RecipeLifecycleClient, selection: Selection): Promise<RecipeLifecycleSnapshot> {
  const target = (await client.recipes.detail(selection.target._id)).data
  if (!sameId(target._id, selection.target._id)) malformed()
  assertContext(target, selection.target)
  const [activeResult, history, productResult, ingredientResults] = await Promise.all([
    client.recipes.list({ productId: target.productId, size: target.size, isActive: true }),
    readHistory(client, target),
    Promise.allSettled([client.products.detail(target.productId)]).then(results => results[0]),
    Promise.allSettled(target.ingredients.map(row => client.ingredients.detail(row.ingredientId))),
  ])
  if (activeResult.pagination.page !== 1 || activeResult.pagination.total > 1
    || activeResult.data.length !== activeResult.pagination.total) malformed()
  const active = activeResult.data[0] ?? null
  if (active) { assertContext(active, target); if (!active.isActive) malformed() }
  const historyTarget = history.find(row => sameId(row._id, target._id))
  const historyActive = history.filter(row => row.isActive)
  if (!historyTarget || !sameContents(historyTarget, target) || historyTarget.isActive !== target.isActive
    || historyTarget.updatedAt !== target.updatedAt || target.isActive !== Boolean(active && sameId(active._id, target._id))
    || historyActive.length !== (active ? 1 : 0)
    || (active && (!sameContents(historyActive[0], active) || historyActive[0].updatedAt !== active.updatedAt))) malformed()
  const issues: string[] = [], referenceErrors: string[] = [], ingredients: Ingredient[] = []
  let product: Product | undefined
  if (productResult.status === 'fulfilled' && sameId(productResult.value.data._id, target.productId)) product = productResult.value.data
  else referenceErrors.push('Product reference could not be verified.')
  ingredientResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && sameId(result.value.data._id, target.ingredients[index].ingredientId)) ingredients.push(result.value.data)
    else referenceErrors.push(`Ingredient ${target.ingredients[index].ingredientId} could not be verified.`)
  })
  if (selection.action === 'activate') {
    issues.push(...referenceErrors)
    if (!target.ingredients.length) issues.push('This Recipe has empty Ingredient membership and cannot be activated.')
    if (product && !product.isAvailable) issues.push('The Product is unavailable. Activation is blocked.')
    if (product && !product.prices.some(price => price.size === target.size)) issues.push('The Product no longer supports this size.')
    ingredients.filter(row => !row.isActive).forEach(row => issues.push(`Ingredient ${row.name} (${row._id}) is inactive. Activation is blocked.`))
    if (target.isActive) issues.push('This Recipe is already active. No activation request will be sent.')
  } else if (!target.isActive) issues.push('This Recipe is no longer the current active version. A different active version will not be deactivated.')
  return { target, active, history, product, ingredients, issues, referenceErrors }
}
function fingerprint(snapshot: RecipeLifecycleSnapshot) {
  return stable({ ...snapshot, target: { ...contents(snapshot.target), isActive: snapshot.target.isActive, updatedAt: snapshot.target.updatedAt },
    active: snapshot.active && { ...contents(snapshot.active), updatedAt: snapshot.active.updatedAt },
    history: snapshot.history.map(row => ({ ...contents(row), isActive: row.isActive, updatedAt: row.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)),
    ingredients: [...snapshot.ingredients].sort((a, b) => a._id.localeCompare(b._id)) })
}

/** Event-driven lifecycle state machine, above the keyed directory and history workspaces. */
export function useRecipeLifecycle(client: RecipeLifecycleClient, lock: RecipeMutationLock) {
  const [phase, setPhase] = useState<Phase>('idle')
  const gate = useRef<Phase>('idle')
  const [visible, setVisible] = useState(false)
  const [selection, setSelection] = useState<Selection>()
  const selected = useRef<Selection | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<RecipeLifecycleSnapshot>()
  const observed = useRef<RecipeLifecycleSnapshot | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const wasConfirmed = useRef(false)
  const alive = useRef(true), generation = useRef(0)
  const opener = useRef<HTMLElement | undefined>(undefined)
  const returnRegion = useRef<Element | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // Restore focus after React has removed the confirmation and enabled its opener.
  useEffect(() => {
    if (!visible && phase === 'idle') {
      if (opener.current?.isConnected) opener.current.focus()
      else if (returnRegion.current?.isConnected) returnRegion.current.querySelector<HTMLElement>('h2')?.focus()
    }
  }, [visible, phase])
  function transition(next: Phase) { gate.current = next; setPhase(next) }
  function remember(next: RecipeLifecycleSnapshot) { observed.current = next; setSnapshot(next) }
  function current(token: number) { return alive.current && generation.current === token }
  const busy = ['checking', 'rechecking', 'saving', 'reconciling'].includes(phase)

  async function begin(action: RecipeLifecycleAction, target: Recipe, button?: HTMLElement) {
    if (lock.current.current || !['idle', 'confirmed', 'reconciled', 'rejected'].includes(gate.current) || !lock.acquire('lifecycle')) return
    const next = { action, target }, token = ++generation.current
    opener.current = button; returnRegion.current = button?.closest('[aria-label="Recipe version history"]') ?? null
    selected.current = next; setSelection(next)
    observed.current = undefined; setSnapshot(undefined); setMessage(''); wasConfirmed.current = false; setConfirmed(false)
    setVisible(true); transition('checking')
    try {
      const result = await readSnapshot(client, next)
      if (!current(token)) return
      remember(result); transition(result.issues.length ? 'blocked' : 'ready')
    } catch (error) {
      if (!current(token)) return
      setMessage(`No mutation request was sent. ${safeMessage(error)}`); transition('blocked')
    }
  }
  function cancel() {
    if (['saving', 'rechecking', 'uncertain', 'reconciling'].includes(gate.current)) return
    generation.current++; setVisible(false); transition('idle'); lock.release('lifecycle')
  }
  async function refreshServerState(onInvalidated: () => void) {
    if (!selected.current || !['uncertain', 'confirmed', 'reconciled', 'rejected', 'blocked'].includes(gate.current)
      || !lock.acquire('lifecycle')) return
    const previous = gate.current, token = ++generation.current
    transition('reconciling'); setMessage('')
    onInvalidated()
    try {
      const result = await readSnapshot(client, selected.current)
      if (!current(token)) return
      remember(result)
      setMessage(wasConfirmed.current
        ? 'The operation was confirmed. Server reads have been refreshed.'
        : 'Server state was observed after refresh. These observations do not establish which request or actor caused this state. Start a new action for fresh confirmation.')
      transition(wasConfirmed.current ? 'confirmed' : 'reconciled'); lock.release('lifecycle')
    } catch (error) {
      if (!current(token)) return
      setMessage(`${wasConfirmed.current ? 'The operation was confirmed, but displayed data may be outdated.' : 'Server state could not be fully reconciled; Recipe mutations remain blocked.'} ${safeMessage(error)}`)
      transition(wasConfirmed.current ? 'confirmed' : previous === 'uncertain' ? 'uncertain' : 'blocked')
      if (wasConfirmed.current) lock.release('lifecycle')
    }
  }
  async function confirm(onInvalidated: () => void) {
    if (gate.current !== 'ready' || !selected.current || !observed.current || observed.current.issues.length
      || lock.current.current !== 'lifecycle') return
    const attempt = selected.current, before = observed.current, token = generation.current
    transition('rechecking'); setMessage('')
    let fresh: RecipeLifecycleSnapshot
    try {
      fresh = await readSnapshot(client, attempt)
      if (!current(token)) return
      remember(fresh)
      if (fingerprint(before) !== fingerprint(fresh) || fresh.issues.length) {
        setMessage('Server state changed. No mutation request was sent. Review the updated context and confirm again.')
        transition(fresh.issues.length ? 'blocked' : 'ready'); return
      }
    } catch (error) {
      if (!current(token)) return
      setMessage(`Confirmation recheck failed. No mutation request was sent. ${safeMessage(error)}`); transition('blocked'); return
    }
    transition('saving')
    try {
      const record = (await client.recipes[attempt.action](fresh.target._id)).data
      if (!sameContents(record, fresh.target) || record.isActive !== (attempt.action === 'activate')) malformed()
    } catch (error) {
      if (!current(token)) return
      const rejected = error instanceof CatalogApiError && ['BAD_REQUEST', 'NOT_FOUND', 'CONFLICT', 'CONFIGURATION'].includes(error.code)
      setMessage(rejected ? `The operation was rejected. ${safeMessage(error)} Start a new action for fresh confirmation.`
        : `The lifecycle outcome is unknown. The request may have been applied. Refresh server state before any further Recipe mutation. ${safeMessage(error)}`)
      transition(rejected ? 'rejected' : 'uncertain')
      if (rejected) lock.release('lifecycle')
      return
    }
    if (!current(token)) return
    // POST confirmation is permanent even if any subsequent GET fails.
    wasConfirmed.current = true; setConfirmed(true); transition('reconciling')
    setMessage(`Recipe ${attempt.action === 'activate' ? 'activation' : 'deactivation'} was confirmed. Refreshing server reads...`)
    onInvalidated()
    try {
      const result = await readSnapshot(client, attempt)
      if (!current(token)) return
      remember(result)
      setMessage(`Recipe ${attempt.action === 'activate' ? 'activation' : 'deactivation'} was confirmed. Server reads have been refreshed.`)
    } catch (error) {
      if (!current(token)) return
      setMessage(`The operation was confirmed, but displayed data may be outdated. Use Refresh server state for GET-only reads. ${safeMessage(error)}`)
    }
    if (!current(token)) return
    transition('confirmed'); lock.release('lifecycle')
  }
  return { visible, phase, busy, locked: lock.owner === 'lifecycle', blockedByCreation: lock.owner === 'creation',
    selection, snapshot, message, confirmed, begin, confirm, cancel, refreshServerState,
    canConfirm: phase === 'ready' && !snapshot?.issues.length && lock.owner === 'lifecycle',
    canCancel: !['saving', 'rechecking', 'uncertain', 'reconciling'].includes(phase) }
}
export type RecipeLifecycleModel = ReturnType<typeof useRecipeLifecycle>
