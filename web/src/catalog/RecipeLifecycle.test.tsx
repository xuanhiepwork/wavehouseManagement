// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatalogClient } from '../api/catalog'
import type { Ingredient, Product, Recipe, RecipeInput } from '../api/catalog'
import CatalogReferencePicker from './CatalogReferencePicker'
import Catalog from './Catalog'
import {
  emptyRecipeDraft, isRecipeUuid, normalizeRecipeQuantity, normalizeUuid,
  recipeMatchesPayload, validateRecipeCreation,
} from './recipe.validation'

const refProductId = 'abcdef12-abcd-abcd-abcd-abcdef123456'
const refIngredientId = 'abcdef12-abcd-abcd-abcd-abcdef123457'
const refOtherId = 'abcdef12-abcd-abcd-abcd-abcdef123458'
const refMetadata = { createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T01:00:00.000Z' }
const refProduct: Product = {
  ...refMetadata, _id: refProductId, code: 'TEA', name: 'Picker tea', category: 'Drinks',
  isAvailable: true, prices: [{ size: 'L', price: '3' }, { size: 'S', price: '1' }],
}
const refIngredient: Ingredient = {
  ...refMetadata, _id: refIngredientId, code: 'MILK', name: 'Picker milk', category: 'Dairy',
  unit: 'ml', costPrice: '1', minStock: '0', isActive: true,
}
const refOther: Ingredient = { ...refIngredient, _id: refOtherId, code: 'SUGAR', name: 'Picker sugar', unit: 'g' }
const refPayload: RecipeInput = {
  productId: refProductId, size: 'S', ingredients: [{ ingredientId: refIngredientId, quantity: '0001.250000' }],
}
const refRecipe: Recipe = {
  ...refMetadata, ...refPayload, _id: 'abcdef12-abcd-abcd-abcd-abcdef123459', version: 3,
  isActive: false, ingredients: [{ ingredientId: refIngredientId, quantity: '1.25' }],
}

function refJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
function refPage(data: unknown[], pageNumber = 1, total = data.length, limit = 10) {
  return refJson({ data, pagination: { page: pageNumber, limit, total, totalPages: Math.ceil(total / limit) } })
}
function refDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
type RefHandler = (url: URL) => Response | Promise<Response> | undefined
function refClient(handler?: RefHandler) {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked network request is forbidden') }))
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    if (init?.method !== 'GET') throw new Error('Reference selection must never mutate')
    const url = new URL(String(input))
    const override = handler?.(url)
    if (override !== undefined) return override
    if (url.pathname === '/api/products') return refPage([refProduct])
    if (url.pathname === '/api/ingredients') return refPage([refIngredient])
    throw new Error('Unexpected mocked reference request')
  })
  return {
    client: createCatalogClient({ baseUrl: 'http://127.0.0.1:5000/api', fetch, timeoutMs: 5_000 }),
    fetch,
    urls: () => fetch.mock.calls.map(([input]) => new URL(String(input))),
  }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Recipe draft validation and exact comparison', () => {
  it('requires Product, supported size, and at least one Ingredient', () => {
    const result = validateRecipeCreation(emptyRecipeDraft())
    expect(Object.keys(result.errors)).toEqual(['productId', 'size', 'ingredients'])
    expect(result.payload).toBeUndefined()
    expect(emptyRecipeDraft()).toEqual({ productId: '', size: '', ingredients: [] })
  })

  it.each(['999999999999.999999', '000001.250000', '0.000001', '1', '0000000000000001.000000'])('preserves valid quantity %s as exact payload text', quantity => {
    const result = validateRecipeCreation({ ...refPayload, ingredients: [{ ingredientId: refIngredientId, quantity }] })
    expect(result.errors).toEqual({})
    expect(result.payload?.ingredients[0].quantity).toBe(quantity)
    expect(typeof result.payload?.ingredients[0].quantity).toBe('string')
  })

  it.each([
    '', '0', '0.000000', '000.000000', '+1', '-1', '1e2', '1E2', ' 1', '1 ', '1\n',
    '.1', '1.', '1.0000000', '0.0000001', '1000000000000', '1,25', 'NaN', 'Infinity', '0'.repeat(100) + '1',
  ])('rejects invalid or semantically zero quantity %j without constructing a payload', quantity => {
    const result = validateRecipeCreation({ ...refPayload, ingredients: [{ ingredientId: refIngredientId, quantity }] })
    expect(result.errors.quantity0).toBeTruthy()
    expect(result.payload).toBeUndefined()
    expect(normalizeRecipeQuantity(quantity)).toBeUndefined()
  })

  it('keeps only the exact POST fields and copies Ingredient rows in draft order', () => {
    const draft = { ...refPayload, ingredients: [
      { ingredientId: refOtherId.toUpperCase(), quantity: '999999999999.999999' },
      { ingredientId: refIngredientId, quantity: '0001.250000' },
    ] }
    const result = validateRecipeCreation(draft)
    expect(result.payload).toEqual(draft)
    expect(Object.keys(result.payload!)).toEqual(['productId', 'size', 'ingredients'])
    expect(Object.keys(result.payload!.ingredients[0])).toEqual(['ingredientId', 'quantity'])
    expect(result.payload!.ingredients).not.toBe(draft.ingredients)
    expect(result.payload!.ingredients[0]).not.toBe(draft.ingredients[0])
  })

  it('rejects duplicate Ingredient UUIDs regardless of letter case', () => {
    const result = validateRecipeCreation({ ...refPayload, ingredients: [
      { ingredientId: refIngredientId, quantity: '1' },
      { ingredientId: refIngredientId.toUpperCase(), quantity: '2' },
    ] })
    expect(result.errors.ingredientId1).toMatch(/only once/)
    expect(result.payload).toBeUndefined()
  })

  it.each(['', 'not-a-uuid', ` ${refIngredientId}`, `${refIngredientId} `])('rejects malformed UUID %j without trimming it into validity', ingredientId => {
    expect(isRecipeUuid(ingredientId)).toBe(false)
    expect(validateRecipeCreation({ ...refPayload, productId: ingredientId }).errors.productId).toBeTruthy()
    expect(validateRecipeCreation({ ...refPayload, ingredients: [{ ingredientId, quantity: '1' }] }).errors.ingredientId0).toBeTruthy()
  })

  it('normalizes UUID case and insignificant decimal zeros entirely as strings', () => {
    expect(normalizeUuid(refIngredientId.toUpperCase())).toBe(refIngredientId)
    expect(normalizeRecipeQuantity('0001.250000')).toBe('1.25')
    expect(normalizeRecipeQuantity('999999999999.999999')).toBe('999999999999.999999')
    expect(normalizeRecipeQuantity('0.000001')).toBe('0.000001')
  })

  it('finds a possible matching recipe across UUID case, ingredient order, and canonical decimal representation', () => {
    const payload = { ...refPayload, productId: refProductId.toUpperCase(), ingredients: [
      { ingredientId: refOtherId.toUpperCase(), quantity: '0002.000000' }, ...refPayload.ingredients,
    ] }
    const recipe = { ...refRecipe, ingredients: [
      { ingredientId: refIngredientId.toUpperCase(), quantity: '1.25' },
      { ingredientId: refOtherId, quantity: '2' },
    ] }
    expect(recipeMatchesPayload(recipe, payload)).toBe(true)
    expect(recipeMatchesPayload({ ...recipe, isActive: true, version: 99 }, payload)).toBe(true)
  })

  it('never equates quantities that differ in the final exact decimal digit', () => {
    const payload = { ...refPayload, ingredients: [{ ingredientId: refIngredientId, quantity: '999999999999.999998' }] }
    const recipe = { ...refRecipe, ingredients: [{ ingredientId: refIngredientId, quantity: '999999999999.999999' }] }
    expect(recipeMatchesPayload(recipe, payload)).toBe(false)
  })

  it('rejects possible matches with another Product, size, empty history, malformed IDs, or duplicate rows', () => {
    expect(recipeMatchesPayload({ ...refRecipe, productId: refOtherId }, refPayload)).toBe(false)
    expect(recipeMatchesPayload({ ...refRecipe, size: 'M' }, refPayload)).toBe(false)
    expect(recipeMatchesPayload({ ...refRecipe, ingredients: [] }, refPayload)).toBe(false)
    expect(recipeMatchesPayload({ ...refRecipe, productId: 'not-a-uuid' }, refPayload)).toBe(false)
    expect(recipeMatchesPayload(refRecipe, { ...refPayload, ingredients: [] })).toBe(false)
    expect(recipeMatchesPayload({ ...refRecipe, ingredients: [refRecipe.ingredients[0], refRecipe.ingredients[0]] }, {
      ...refPayload, ingredients: [refPayload.ingredients[0], refPayload.ingredients[0]],
    })).toBe(false)
  })
})

describe('Catalog reference selection', () => {
  it('defaults to available Products and displays only supported sizes in S/M/L order', async () => {
    const { client, urls, fetch } = refClient()
    const onSelect = vi.fn()
    render(<CatalogReferencePicker client={client} kind="product" onSelect={onSelect} />)
    const table = await screen.findByRole('table', { name: 'Product selection results' })
    expect(within(table).getByText('S, L')).toBeTruthy()
    expect(urls()[0].searchParams.get('isAvailable')).toBe('true')
    expect(urls()[0].searchParams.get('page')).toBe('1')
    expect(urls()[0].searchParams.get('limit')).toBe('10')
    expect(urls()[0].searchParams.has('search')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Select Picker tea' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(refProduct)
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('paginates Products and resets to page one when the page size changes', async () => {
    const { client, urls } = refClient(url => refPage([refProduct], +(url.searchParams.get('page') ?? '1'), 21, +(url.searchParams.get('limit') ?? '10')))
    render(<CatalogReferencePicker client={client} kind="product" onSelect={vi.fn()} />)
    await screen.findByText('Page 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: 'Next products page' }))
    await screen.findByText('Page 2 of 3')
    expect(urls().at(-1)?.searchParams.get('page')).toBe('2')
    fireEvent.change(screen.getByLabelText('Products per page'), { target: { value: '20' } })
    await screen.findByText('Page 1 of 2')
    expect(urls().at(-1)?.searchParams.get('limit')).toBe('20')
    expect(urls().at(-1)?.searchParams.get('page')).toBe('1')
  })

  it('serializes an explicit unavailable Product filter, trimmed search, and a reset page', async () => {
    const { client, urls } = refClient(url => refPage([{ ...refProduct, isAvailable: false }], +(url.searchParams.get('page') ?? '1'), 21))
    render(<CatalogReferencePicker client={client} kind="product" onSelect={vi.fn()} />)
    await screen.findByText('Page 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: 'Next products page' }))
    await screen.findByText('Page 2 of 3')
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: ' tea & milk ' } })
    fireEvent.change(screen.getByLabelText('Product availability'), { target: { value: 'false' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply product filters' }))
    await waitFor(() => expect(urls().at(-1)?.searchParams.get('search')).toBe('tea & milk'))
    expect(urls().at(-1)?.searchParams.get('isAvailable')).toBe('false')
    expect(urls().at(-1)?.searchParams.get('page')).toBe('1')
    expect(screen.getByText(/Unavailable products can be used in an inactive recipe draft/).textContent).toContain('does not establish activation eligibility')
  })

  it('offers active or explicitly inactive Ingredients without inventing a combined-all filter', async () => {
    const { client, urls } = refClient(url => refPage([{ ...refIngredient, isActive: url.searchParams.get('isActive') !== 'false' }]))
    const onSelect = vi.fn()
    render(<CatalogReferencePicker client={client} kind="ingredient" onSelect={onSelect} />)
    await screen.findByRole('table', { name: 'Ingredient selection results' })
    expect(urls()[0].searchParams.get('isActive')).toBe('true')
    const status = screen.getByLabelText('Ingredient status')
    expect(within(status).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['true', 'false'])
    fireEvent.change(status, { target: { value: 'false' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply ingredient filters' }))
    await screen.findByText('Inactive', { selector: '.status' })
    expect(urls().at(-1)?.searchParams.get('isActive')).toBe('false')
    expect(screen.getByText(/Inactive ingredients can be used in an inactive recipe draft/).textContent).toContain('does not establish activation eligibility')
    await userEvent.click(screen.getByRole('button', { name: 'Add Picker milk' }))
    expect(onSelect.mock.calls[0][0].isActive).toBe(false)
  })

  it('retains selected UUIDs across pages, searches, and active/inactive filters and prevents duplicate selection', async () => {
    const { client } = refClient(url => {
      const current = +(url.searchParams.get('page') ?? '1')
      const item = current === 2 ? refOther : refIngredient
      return refPage([{ ...item, isActive: url.searchParams.get('isActive') !== 'false' }], current, 11)
    })
    const selected = vi.fn()
    function Selections() {
      const [ids, setIds] = useState<string[]>([])
      return <><output aria-label="Selected Ingredient count">{ids.length}</output>
        <CatalogReferencePicker client={client} kind="ingredient" selectedIds={ids} onSelect={item => {
          selected(item)
          setIds(previous => [...previous, item._id.toUpperCase()])
        }} /></>
    }
    render(<Selections />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add Picker milk' }))
    expect(screen.getByRole('button', { name: 'Selected Picker milk' })).toHaveProperty('disabled', true)
    await userEvent.click(screen.getByRole('button', { name: 'Next ingredients page' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add Picker sugar' }))
    expect(screen.getByLabelText('Selected Ingredient count').textContent).toBe('2')
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'milk' } })
    fireEvent.change(screen.getByLabelText('Ingredient status'), { target: { value: 'false' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply ingredient filters' }))
    const duplicate = await screen.findByRole('button', { name: 'Selected Picker milk' })
    expect(duplicate).toHaveProperty('disabled', true)
    expect(duplicate.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(duplicate)
    expect(selected).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Selected Ingredient count').textContent).toBe('2')
  })

  it('uses Enter for search and keyboard selection without submitting the surrounding Recipe form', async () => {
    const { client, urls, fetch } = refClient()
    const onSelect = vi.fn(), onSubmit = vi.fn()
    render(<form aria-label="Test recipe draft" onSubmit={event => { event.preventDefault(); onSubmit() }}>
      <CatalogReferencePicker client={client} kind="product" onSelect={onSelect} />
    </form>)
    await screen.findByRole('table')
    const user = userEvent.setup()
    const search = screen.getByLabelText('Search products')
    search.focus()
    await user.type(search, 'tea{Enter}')
    await waitFor(() => expect(urls().at(-1)?.searchParams.get('search')).toBe('tea'))
    const select = await screen.findByRole('button', { name: 'Select Picker tea' })
    select.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(screen.getByRole('region', { name: 'Product selection results' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getAllByRole('columnheader').every(header => header.getAttribute('scope') === 'col')).toBe(true)
  })

  it('shows loading and an empty state using only mocked GETs', async () => {
    const pending = refDeferred<Response>()
    const { client } = refClient(() => pending.promise)
    render(<CatalogReferencePicker client={client} kind="ingredient" onSelect={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('Loading ingredients for selection')
    expect(screen.getByRole('button', { name: 'Next ingredients page' })).toHaveProperty('disabled', true)
    await act(async () => pending.resolve(refPage([])))
    expect(await screen.findByText('No ingredients match these selection filters.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('sanitizes errors and retries failed reference reads only on explicit action', async () => {
    let failed = true
    const { client, fetch } = refClient(() => failed ? refJson({ error: 'password=private database failure' }, 500) : refPage([refProduct]))
    render(<CatalogReferencePicker client={client} kind="product" onSelect={vi.fn()} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Unable to load products for selection')
    expect(alert.textContent).not.toContain('password=')
    expect(fetch).toHaveBeenCalledOnce()
    failed = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry products selection' }))
    expect(await screen.findByRole('button', { name: 'Select Picker tea' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('prevents a stale response from replacing a newer search result', async () => {
    const pending = refDeferred<Response>()
    const { client } = refClient(url => url.searchParams.get('search') === 'old' ? pending.promise : refPage([refProduct]))
    render(<CatalogReferencePicker client={client} kind="product" onSelect={vi.fn()} />)
    await screen.findByRole('table')
    const search = screen.getByLabelText('Search products')
    fireEvent.change(search, { target: { value: 'old' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply product filters' }))
    await screen.findByRole('status')
    fireEvent.change(search, { target: { value: 'new' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply product filters' }))
    await screen.findByRole('button', { name: 'Select Picker tea' })
    await act(async () => pending.resolve(refPage([{ ...refProduct, name: 'Stale product' }])))
    expect(screen.getByRole('button', { name: 'Select Picker tea' })).toBeTruthy()
    expect(screen.queryByText('Stale product')).toBeNull()
  })

  it('prevents a stale error from replacing a newer filter result', async () => {
    const pending = refDeferred<Response>()
    const { client } = refClient(url => url.searchParams.get('search') === 'old' ? pending.promise : refPage([refIngredient]))
    render(<CatalogReferencePicker client={client} kind="ingredient" onSelect={vi.fn()} />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'old' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply ingredient filters' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'new' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply ingredient filters' }))
    await screen.findByRole('button', { name: 'Add Picker milk' })
    await act(async () => pending.reject(new Error('late network failure')))
    expect(screen.getByRole('button', { name: 'Add Picker milk' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('isolates pending reads when switching picker kinds and hides disabled pickers safely', async () => {
    const pending = refDeferred<Response>()
    const { client } = refClient(url => url.pathname === '/api/products' ? pending.promise : refPage([refIngredient]))
    const onSelect = vi.fn()
    const { rerender } = render(<CatalogReferencePicker client={client} kind="product" onSelect={onSelect} />)
    await screen.findByRole('status')
    rerender(<CatalogReferencePicker client={client} kind="ingredient" onSelect={onSelect} disabled />)
    const button = await screen.findByRole('button', { name: 'Add Picker milk' })
    await userEvent.click(button)
    expect(onSelect).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Search ingredients') as HTMLInputElement).closest('fieldset')).toHaveProperty('disabled', true)
    await act(async () => pending.resolve(refPage([refProduct])))
    expect(screen.queryByText('Picker tea')).toBeNull()
    rerender(<CatalogReferencePicker client={client} kind="ingredient" onSelect={onSelect} visible={false} />)
    expect(screen.queryByRole('region', { name: 'Ingredient selection' })).toBeNull()
  })
})

type LifecycleHandler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined
function lifecycleSetup(handler?: LifecycleHandler, timeoutMs = 5_000) {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked network request is forbidden') }))
  const created: Recipe[] = []
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, initial) => {
    const init = initial ?? {}
    const url = new URL(String(input))
    if (url.origin !== 'http://127.0.0.1:5000') throw new Error('Unexpected mocked origin')
    const override = handler?.(url, init)
    if (override !== undefined) return override
    if (init.method === 'GET') {
      if (url.pathname === '/api/products') return refPage([refProduct], +(url.searchParams.get('page') ?? '1'), 1, +(url.searchParams.get('limit') ?? '20'))
      if (url.pathname === '/api/ingredients') return refPage([refIngredient, refOther], +(url.searchParams.get('page') ?? '1'), 2, +(url.searchParams.get('limit') ?? '20'))
      if (url.pathname === `/api/products/${refProductId}`) return refJson({ data: refProduct })
      if (url.pathname === `/api/ingredients/${refIngredientId}`) return refJson({ data: refIngredient })
      if (url.pathname === `/api/ingredients/${refOtherId}`) return refJson({ data: refOther })
      if (url.pathname === '/api/recipes') {
        const records = created.filter(record => (!url.searchParams.has('productId') || record.productId === url.searchParams.get('productId'))
          && (!url.searchParams.has('size') || record.size === url.searchParams.get('size'))
          && (!url.searchParams.has('isActive') || String(record.isActive) === url.searchParams.get('isActive')))
        const current = +(url.searchParams.get('page') ?? '1'), limit = +(url.searchParams.get('limit') ?? '20')
        return refPage(records.slice((current - 1) * limit, current * limit), current, records.length, limit)
      }
      const record = created.find(recipe => url.pathname === `/api/recipes/${recipe._id}`)
      if (record) return refJson({ data: record })
    }
    if (init.method === 'POST' && url.pathname === '/api/recipes') {
      const payload = JSON.parse(String(init.body)) as RecipeInput
      const record: Recipe = { ...refMetadata, ...payload, _id: refRecipe._id, version: 3, isActive: false,
        ingredients: payload.ingredients.map(row => ({ ...row, quantity: normalizeRecipeQuantity(row.quantity)! })) }
      created.push(record)
      return refJson({ data: record }, 201)
    }
    throw new Error('Unexpected mocked lifecycle request')
  })
  const client = createCatalogClient({ baseUrl: 'http://127.0.0.1:5000/api', fetch, timeoutMs })
  const rendered = render(<Catalog client={client} />)
  return {
    client, fetch, user: userEvent.setup(), created, unmount: rendered.unmount,
    posts: () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST'),
    gets: () => fetch.mock.calls.filter(([, init]) => init?.method === 'GET').map(([url]) => new URL(String(url))),
  }
}
async function lifecycleOpen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Recipes' }))
  await user.click(screen.getByRole('button', { name: 'New recipe' }))
  return screen.getByRole('form', { name: 'Create recipe' })
}
async function lifecycleFill(user: ReturnType<typeof userEvent.setup>, form: HTMLElement, quantity = '0001.250000') {
  await user.click(await within(form).findByRole('button', { name: 'Select Picker tea' }))
  await waitFor(() => expect(within(form).getByLabelText('Recipe size')).toHaveProperty('disabled', false))
  fireEvent.change(within(form).getByLabelText('Recipe size'), { target: { value: 'S' } })
  await user.click(await within(form).findByRole('button', { name: 'Add Picker milk' }))
  fireEvent.change(within(form).getByLabelText('Quantity 1'), { target: { value: quantity } })
}
function lifecycleSubmit(form: HTMLElement) { fireEvent.submit(form) }
const lifecycleAck = 'I reviewed server state and understand resubmission may create an additional version.'
function lifecycleHistory(rows: Recipe[], url: URL) {
  const current = +(url.searchParams.get('page') ?? '1'), limit = +(url.searchParams.get('limit') ?? '20')
  return refPage(rows.slice((current - 1) * limit, current * limit), current, rows.length, limit)
}
function lifecycleVersion(version: number, overrides: Partial<Recipe> = {}): Recipe {
  return { ...refRecipe, _id: `00000000-0000-0000-0000-${String(version).padStart(12, '0')}`, version, ...overrides }
}

describe('Recipe creation integration', () => {
  it('restores focus when closing creation while existing details remain selected', async () => {
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === '/api/recipes') return lifecycleHistory([refRecipe], url)
      if (url.pathname === `/api/recipes/${refRecipe._id}`) return refJson({ data: refRecipe })
    })
    await user.click(screen.getByRole('button', { name: 'Recipes' }))
    await user.click(await screen.findByRole('button', { name: `View recipe S version 3 for ${refProductId}` }))
    await screen.findByRole('region', { name: 'Record details' })
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Create recipe' }))
    await user.click(screen.getByRole('button', { name: 'Close recipe form' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New recipe' }))
    expect(screen.getByRole('region', { name: 'Record details' })).toBeTruthy()
    expect(posts()).toHaveLength(0)
  })

  it('restores focus to New recipe after closing details opened by successful creation', async () => {
    const { user } = lifecycleSetup()
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText(/Recipe version 3 created successfully/)
    const details = await screen.findByRole('region', { name: 'Record details' })
    await within(details).findByText(refRecipe._id)
    expect(document.activeElement).toBe(within(details).getByRole('heading', { name: 'Record details' }))
    await user.click(within(details).getByRole('button', { name: 'Close details' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New recipe' }))
  })

  it('opens a possible matching version without resubmitting and restores focus when its details close', async () => {
    let reviewing = false
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Unknown' }, 500)
      if (url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') return lifecycleHistory(reviewing ? [refRecipe] : [], url)
      if (url.pathname === `/api/recipes/${refRecipe._id}`) return refJson({ data: refRecipe })
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    reviewing = true
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await user.click(await screen.findByRole('button', { name: 'View possible version 3' }))
    const details = await screen.findByRole('region', { name: 'Record details' })
    await within(details).findByText(refRecipe._id)
    await user.click(within(details).getByRole('button', { name: 'Close details' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New recipe' }))
    expect(posts()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    expect(screen.getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(screen.getByRole('button', { name: 'Submit recipe again' })).toHaveProperty('disabled', true)
  })

  it('never sends POST after the Catalog unmounts during preflight', async () => {
    const pending = refDeferred<Response>()
    let checking = false
    const { user, posts, unmount } = lifecycleSetup((url, init) => {
      if (checking && init.method === 'GET' && url.pathname === `/api/products/${refProductId}`) return pending.promise
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    checking = true
    lifecycleSubmit(form)
    expect(screen.getByRole('button', { name: 'Checking references...' })).toHaveProperty('disabled', true)
    unmount()
    await act(async () => pending.resolve(refJson({ data: refProduct })))
    expect(posts()).toHaveLength(0)
  })

  it('submits exact quantity strings and only contract fields, displays the assigned inactive version, and refreshes list and detail', async () => {
    const { user, posts, gets } = lifecycleSetup()
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form, '999999999999.999999')
    await user.click(within(form).getByRole('button', { name: 'Add Picker sugar' }))
    fireEvent.change(within(form).getByLabelText('Quantity 2'), { target: { value: '0001.250000' } })
    const directory = screen.getByRole('region', { name: 'Recipes directory' })
    fireEvent.change(within(directory).getByLabelText('Rows per page'), { target: { value: '10' } })
    fireEvent.change(within(directory).getByLabelText('Status'), { target: { value: 'false' } })
    await user.click(within(directory).getByRole('button', { name: 'Apply filters' }))
    const getsBefore = gets().length
    lifecycleSubmit(form)
    expect(await screen.findByText(/Recipe version 3 created successfully\. Created as Inactive/)).toBeTruthy()
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ productId: refProductId, size: 'S', ingredients: [
      { ingredientId: refIngredientId, quantity: '999999999999.999999' },
      { ingredientId: refOtherId, quantity: '0001.250000' },
    ] })
    expect(screen.queryByRole('form', { name: 'Create recipe' })).toBeNull()
    const details = await screen.findByRole('region', { name: 'Record details' })
    await within(details).findByText(refRecipe._id)
    expect(within(details).getByText('999999999999.999999').textContent).toBe('999999999999.999999')
    const refresh = gets().slice(getsBefore).find(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '10')
    expect(refresh?.searchParams.get('page')).toBe('1')
    expect(refresh?.searchParams.get('isActive')).toBe('false')
    expect(gets().some(url => url.pathname === `/api/recipes/${refRecipe._id}`)).toBe(true)
    expect(posts().every(([url]) => String(url).endsWith('/api/recipes'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    expect(screen.getByLabelText('Selected Product UUID')).toHaveProperty('value', '')
    expect(screen.queryByLabelText('Quantity 1')).toBeNull()
  })

  it('loads detail sizes in S/M/L order and clears size but preserves Ingredient quantities on a Product change', async () => {
    const second: Product = { ...refProduct, _id: refOtherId, name: 'Different product', code: 'OTHER', prices: [{ size: 'M', price: '2' }] }
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'GET' && url.pathname === '/api/products') return refPage([refProduct, second])
      if (init.method === 'GET' && url.pathname === `/api/products/${second._id}`) return refJson({ data: second })
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    const size = within(form).getByLabelText('Recipe size')
    expect(within(size).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a supported size', 'S', 'L'])
    await user.click(within(form).getByRole('button', { name: 'Select Different product' }))
    await waitFor(() => expect(within(size).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a supported size', 'M']))
    expect(size).toHaveProperty('value', '')
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(within(form).getByLabelText('Selected Product UUID')).toHaveProperty('value', refOtherId)
    expect(posts()).toHaveLength(0)
  })

  it('keeps the draft through closing, reopening, and section navigation', async () => {
    const { user, posts } = lifecycleSetup()
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    await user.click(screen.getByRole('button', { name: 'Close recipe form' }))
    expect(screen.queryByRole('form', { name: 'Create recipe' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    expect(screen.getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    await user.click(screen.getByRole('button', { name: 'Products' }))
    await user.click(screen.getByRole('button', { name: 'Recipes' }))
    const reopened = screen.getByRole('form', { name: 'Create recipe' })
    expect(within(reopened).getByLabelText('Selected Product UUID')).toHaveProperty('value', refProductId)
    expect(within(reopened).getByLabelText('Recipe size')).toHaveProperty('value', 'S')
    expect(within(reopened).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(posts()).toHaveLength(0)
  })

  it('shows selected inactive reference details and warns without claiming activation eligibility', async () => {
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'GET' && url.pathname === '/api/ingredients' && url.searchParams.get('isActive') === 'false') return refPage([{ ...refIngredient, isActive: false }])
      if (init.method === 'GET' && url.pathname === `/api/ingredients/${refIngredientId}`) return refJson({ data: { ...refIngredient, isActive: false } })
    })
    const form = await lifecycleOpen(user)
    fireEvent.change(within(form).getByLabelText('Ingredient status'), { target: { value: 'false' } })
    await user.click(within(form).getByRole('button', { name: 'Apply ingredient filters' }))
    await user.click(await within(form).findByRole('button', { name: 'Add Picker milk' }))
    const selected = within(form).getByRole('region', { name: 'Selected Ingredients' })
    await within(selected).findByText('Picker milk')
    expect(within(selected).getByText(/MILK.*Unit: ml.*Inactive/)).toBeTruthy()
    expect(within(selected).getByText(refIngredientId)).toBeTruthy()
    expect(within(selected).getByText('This Ingredient is inactive. This draft does not establish activation eligibility.')).toBeTruthy()
    await user.click(within(selected).getByRole('button', { name: 'Remove Ingredient 1' }))
    expect(within(selected).queryByLabelText('Quantity 1')).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('announces field errors, links them to inputs, and focuses the first invalid field without preflight or POST', async () => {
    const { user, posts, gets } = lifecycleSetup()
    const form = await lifecycleOpen(user)
    const before = gets().length
    lifecycleSubmit(form)
    const product = within(form).getByLabelText('Selected Product UUID')
    await waitFor(() => expect(product.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(product)
    expect(document.getElementById(product.getAttribute('aria-describedby')!)?.textContent).toContain('valid UUID')
    expect(within(form).getByText('Add at least one Ingredient.')).toBeTruthy()
    expect(posts()).toHaveLength(0)
    expect(gets().slice(before).filter(url => url.pathname.startsWith('/api/products/'))).toHaveLength(0)
  })

  it('refreshes selected references and all Product/size history before its single POST', async () => {
    const history = Array.from({ length: 101 }, (_, i) => lifecycleVersion(i + 1, { ingredients: [] }))
    const events: string[] = []
    const { user, posts } = lifecycleSetup((url, init) => {
      events.push(`${init.method} ${url.pathname}${url.search}`)
      if (init.method === 'GET' && url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') return lifecycleHistory(history, url)
      if (init.method === 'POST') return refJson({ data: lifecycleVersion(102, { ingredients: refRecipe.ingredients }) }, 201)
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    events.length = 0
    lifecycleSubmit(form)
    await screen.findByText(/Recipe version 102 created successfully/)
    const postIndex = events.findIndex(event => event.startsWith('POST'))
    expect(events.slice(0, postIndex).some(event => event.includes(`/api/products/${refProductId}`))).toBe(true)
    expect(events.slice(0, postIndex).some(event => event.includes(`/api/ingredients/${refIngredientId}`))).toBe(true)
    const histories = events.slice(0, postIndex).filter(event => event.includes('/api/recipes?'))
    expect(histories).toHaveLength(2)
    expect(histories[0]).toContain(`productId=${refProductId}&size=S&page=1&limit=100`)
    expect(histories[1]).toContain('page=2&limit=100')
    expect(histories.every(event => !event.includes('isActive'))).toBe(true)
    expect(posts()).toHaveLength(1)
  })

  it.each(['product-not-found', 'ingredient-not-found', 'network', 'malformed-history', 'later-history-page'])('preserves the draft and sends no POST after %s preflight failure', async failure => {
    let checking = false
    const history = Array.from({ length: 101 }, (_, i) => lifecycleVersion(i + 1))
    const { user, posts } = lifecycleSetup((url, init) => {
      if (!checking || init.method !== 'GET') return
      if (failure === 'product-not-found' && url.pathname === `/api/products/${refProductId}`) return refJson({ error: 'Not found' }, 404)
      if (failure === 'ingredient-not-found' && url.pathname === `/api/ingredients/${refIngredientId}`) return refJson({ error: 'Not found' }, 404)
      if (failure === 'network' && url.pathname === `/api/ingredients/${refIngredientId}`) throw new Error('mock network failure')
      if (url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') {
        if (failure === 'malformed-history') return refPage([refRecipe], 1, 2, 100)
        if (failure === 'later-history-page') return url.searchParams.get('page') === '2' ? refJson({ error: 'Failed' }, 500) : lifecycleHistory(history, url)
      }
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    checking = true
    lifecycleSubmit(form)
    await screen.findByText(/Preflight failed\. No creation request was sent/)
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(within(form).getByLabelText('Selected Product UUID')).toHaveProperty('value', refProductId)
    expect(posts()).toHaveLength(0)
  })

  it('blocks submission when refreshed Product details no longer support the chosen size', async () => {
    let checking = false
    const { user, posts } = lifecycleSetup((url, init) => checking && init.method === 'GET' && url.pathname === `/api/products/${refProductId}`
      ? refJson({ data: { ...refProduct, prices: [{ size: 'M', price: '2' }] } }) : undefined)
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    checking = true
    lifecycleSubmit(form)
    await screen.findByText('This Product no longer supports the selected size. Choose a current size.')
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(posts()).toHaveLength(0)
    await waitFor(() => expect(within(within(form).getByLabelText('Recipe size')).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a supported size', 'M']))
  })

  it('takes a synchronous submission lock before preflight and keeps it through a pending POST', async () => {
    let checking = false
    const references = refDeferred<Response>(), post = refDeferred<Response>()
    const { user, posts, fetch } = lifecycleSetup((url, init) => {
      if (checking && init.method === 'GET' && url.pathname === `/api/products/${refProductId}`) return references.promise
      if (init.method === 'POST') return post.promise
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    checking = true
    lifecycleSubmit(form); lifecycleSubmit(form)
    expect(screen.getByRole('button', { name: 'Checking references...' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Close recipe form' })).toHaveProperty('disabled', true)
    expect(within(form).getByLabelText('Quantity 1').closest('fieldset.recipe-fields')).toHaveProperty('disabled', true)
    expect(posts()).toHaveLength(0)
    await act(async () => references.resolve(refJson({ data: refProduct })))
    await waitFor(() => expect(posts()).toHaveLength(1))
    lifecycleSubmit(form); lifecycleSubmit(form)
    expect(screen.getByRole('button', { name: 'Creating recipe...' })).toHaveProperty('disabled', true)
    expect(posts()).toHaveLength(1)
    await act(async () => post.resolve(refJson({ data: refRecipe }, 201)))
    await screen.findByText(/Recipe version 3 created successfully/)
    expect(posts()).toHaveLength(1)
    expect(fetch.mock.calls.every(([url, init]) => init?.method === 'GET' || (init?.method === 'POST' && String(url).endsWith('/api/recipes')))).toBe(true)
  })

  it.each(['network', 'timeout', 'server', 'malformed-success', 'unexpected-active', 'unexpected-quantity'])('preserves and locks the attempted draft on %s outcome without automatic retry', async failure => {
    const pending = refDeferred<Response>()
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method !== 'POST' || url.pathname !== '/api/recipes') return
      if (failure === 'network') throw new Error('mock network failure')
      if (failure === 'timeout') return pending.promise
      if (failure === 'server') return refJson({ error: 'private SQL message' }, 500)
      if (failure === 'malformed-success') return refJson({ data: { unexpected: true } }, 201)
      if (failure === 'unexpected-active') return refJson({ data: { ...refRecipe, isActive: true } }, 201)
      return refJson({ data: { ...refRecipe, ingredients: [{ ingredientId: refIngredientId, quantity: '1.250001' }] } }, 201)
    }, failure === 'timeout' ? 150 : 5_000)
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByRole('status', { name: 'Recipe outcome review' })
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Creation outcome is unknown')).toBeTruthy()
    expect(screen.queryByText('private SQL message')).toBeNull()
    lifecycleSubmit(form); lifecycleSubmit(form)
    expect(posts()).toHaveLength(1)
    if (failure === 'timeout') await act(async () => pending.resolve(refJson({ data: refRecipe }, 201)))
    expect(posts()).toHaveLength(1)
    expect(screen.queryByLabelText(lifecycleAck)).toBeNull()
  })

  it.each([400, 404, 409])('preserves a rejected draft after HTTP %s and does not automatically retry', async status => {
    const { user, posts } = lifecycleSetup((_url, init) => init.method === 'POST' ? refJson({ error: 'Backend rejected payload' }, status) : undefined)
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', false))
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    expect(screen.queryByRole('status', { name: 'Recipe outcome review' })).toBeNull()
    expect(posts()).toHaveLength(1)
  })

  it('reviews every history page, distinguishes observed versions, and requires acknowledgement before deliberate resubmission', async () => {
    const old = lifecycleVersion(1)
    const newMatch = lifecycleVersion(102, { productId: refProductId.toUpperCase(), ingredients: [{ ingredientId: refIngredientId.toUpperCase(), quantity: '1.25' }] })
    const history = [old, ...Array.from({ length: 100 }, (_, i) => lifecycleVersion(i + 2, { ingredients: [] })), newMatch]
    let reviewing = false, submissions = 0
    const { user, posts, gets } = lifecycleSetup((url, init) => {
      if (init.method === 'GET' && url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') return lifecycleHistory(reviewing ? history : [old], url)
      if (init.method === 'POST') {
        submissions++
        return submissions === 1 ? refJson({ error: 'Unknown server failure' }, 500) : refJson({ data: lifecycleVersion(103) }, 201)
      }
      if (init.method === 'GET' && url.pathname === `/api/recipes/${lifecycleVersion(103)._id}`) return refJson({ data: lifecycleVersion(103) })
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    const review = await screen.findByRole('status', { name: 'Recipe outcome review' })
    expect(within(review).getByText(/Observed before submission: 1 versions/).textContent).toContain('v1')
    expect(within(review).getByText('0001.250000')).toBeTruthy()
    reviewing = true
    await user.click(within(review).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText('Reviewed 102 versions across all history pages, including active and inactive Recipes.')
    expect(screen.getByText('Possible matching versions. A match does not prove this request created it.')).toBeTruthy()
    expect(screen.getByText(/v1.*Observed before submission/)).toBeTruthy()
    expect(screen.getByText(/v102.*Not observed before submission/)).toBeTruthy()
    expect(gets().filter(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100' && url.searchParams.get('page') === '2')).toHaveLength(1)
    expect(within(form).getByRole('button', { name: 'Submit recipe again' })).toHaveProperty('disabled', true)
    lifecycleSubmit(form)
    expect(posts()).toHaveLength(1)
    await user.click(within(form).getByLabelText(lifecycleAck))
    expect(within(form).getByRole('button', { name: 'Submit recipe again' })).toHaveProperty('disabled', false)
    expect(posts()).toHaveLength(1)
    await user.click(within(form).getByRole('button', { name: 'Submit recipe again' }))
    await screen.findByText(/Recipe version 103 created successfully/)
    expect(posts()).toHaveLength(2)
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual(refPayload)
  })

  it('does not infer rollback from absent matches and retains the attempted payload when the draft changes', async () => {
    const { user, posts, gets } = lifecycleSetup((_url, init) => init.method === 'POST' ? refJson({ error: 'Unknown' }, 500) : undefined)
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    fireEvent.change(within(form).getByLabelText('Quantity 1'), { target: { value: '9.999999' } })
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText('No exact quantity/reference match was found. Absence does not prove the request was rolled back.')
    const review = screen.getByRole('status', { name: 'Recipe outcome review' })
    expect(within(review).getByText('0001.250000')).toBeTruthy()
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '9.999999')
    expect(gets().filter(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100').every(url => url.searchParams.get('productId') === refProductId && url.searchParams.get('size') === 'S')).toBe(true)
    await user.click(within(form).getByLabelText(lifecycleAck))
    fireEvent.change(within(form).getByLabelText('Quantity 1'), { target: { value: '10' } })
    expect(within(form).getByLabelText(lifecycleAck)).toHaveProperty('checked', false)
    expect(within(form).getByRole('button', { name: 'Submit recipe again' })).toHaveProperty('disabled', true)
    expect(posts()).toHaveLength(1)
  })

  it('keeps an incomplete reconciliation blocked and does not reuse an earlier acknowledgement', async () => {
    let rejectHistory = false
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Unknown' }, 500)
      if (rejectHistory && url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') return refJson({ error: 'History unavailable' }, 500)
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText(/Reviewed 0 versions/)
    await user.click(within(form).getByLabelText(lifecycleAck))
    rejectHistory = true
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText(/Server state could not be fully reviewed/)
    expect(within(form).queryByLabelText(lifecycleAck)).toBeNull()
    expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', true)
    lifecycleSubmit(form)
    expect(posts()).toHaveLength(1)
  })

  it('keeps prior uncertainty when an acknowledged resubmission fails preflight', async () => {
    let failPreflight = false
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Unknown' }, 500)
      if (failPreflight && url.pathname === `/api/products/${refProductId}`) return refJson({ error: 'Not found' }, 404)
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText(/Reviewed 0 versions/)
    await user.click(within(form).getByLabelText(lifecycleAck))
    failPreflight = true
    lifecycleSubmit(form)
    await screen.findByText(/Preflight failed\. No creation request was sent/)
    expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', true)
    expect(within(form).queryByLabelText(lifecycleAck)).toBeNull()
    expect(posts()).toHaveLength(1)
  })

  it('requires a fresh review after an acknowledged resubmission finds an unsupported size', async () => {
    let unsupported = false
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Unknown' }, 500)
      if (unsupported && url.pathname === `/api/products/${refProductId}`) return refJson({ data: { ...refProduct, prices: [{ size: 'M', price: '2' }] } })
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText(/Reviewed 0 versions/)
    await user.click(within(form).getByLabelText(lifecycleAck))
    unsupported = true
    lifecycleSubmit(form)
    await screen.findByText('This Product no longer supports the selected size. Choose a current size.')
    expect(within(form).queryByLabelText(lifecycleAck)).toBeNull()
    expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', true)
    expect(within(form).getByRole('button', { name: 'Refresh Recipe server state' })).toBeTruthy()
    lifecycleSubmit(form)
    expect(posts()).toHaveLength(1)
  })

  it.each([400, 409])('retains the original unknown attempt when a deliberate second POST returns HTTP %s', async status => {
    let submissions = 0
    const { user, posts } = lifecycleSetup((_url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Rejected' }, ++submissions === 1 ? 500 : status)
    })
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    lifecycleSubmit(form)
    await screen.findByText('Creation outcome is unknown')
    await user.click(within(form).getByRole('button', { name: 'Refresh Recipe server state' }))
    await screen.findByText(/Reviewed 0 versions/)
    fireEvent.change(within(form).getByLabelText('Quantity 1'), { target: { value: '9.999999' } })
    await user.click(within(form).getByLabelText(lifecycleAck))
    lifecycleSubmit(form)
    await waitFor(() => expect(posts()).toHaveLength(2))
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Create recipe' })).toHaveProperty('disabled', true))
    expect(within(form).queryByLabelText(lifecycleAck)).toBeNull()
    expect(within(screen.getByRole('status', { name: 'Recipe outcome review' })).getByText('0001.250000')).toBeTruthy()
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '9.999999')
    lifecycleSubmit(form)
    expect(posts()).toHaveLength(2)
  })

  it('does not let a stale selected Product detail response replace a newer selection or its supported sizes', async () => {
    const pending = refDeferred<Response>()
    const second: Product = { ...refProduct, _id: refOtherId, name: 'Newer product', code: 'NEW', prices: [{ size: 'M', price: '2' }] }
    const { user, posts } = lifecycleSetup((url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === '/api/products') return refPage([refProduct, second])
      if (url.pathname === `/api/products/${refProductId}`) return pending.promise
      if (url.pathname === `/api/products/${refOtherId}`) return refJson({ data: second })
    })
    const form = await lifecycleOpen(user)
    await user.click(await within(form).findByRole('button', { name: 'Select Picker tea' }))
    await within(form).findByText('Loading selected Product details...')
    await user.click(within(form).getByRole('button', { name: 'Select Newer product' }))
    const selected = within(form).getByRole('region', { name: 'Selected Product' })
    await within(selected).findByText('Newer product')
    await act(async () => pending.resolve(refJson({ data: refProduct })))
    expect(within(selected).queryByText('Picker tea')).toBeNull()
    expect(within(form).getByLabelText('Selected Product UUID')).toHaveProperty('value', refOtherId)
    expect(within(within(form).getByLabelText('Recipe size')).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a supported size', 'M'])
    expect(posts()).toHaveLength(0)
  })
})

function isHistoryRead(url: URL) {
  return url.pathname === '/api/recipes' && url.searchParams.has('productId')
    && url.searchParams.has('size') && !url.searchParams.has('isActive')
    && url.searchParams.get('limit') === '20'
}
function isActiveHistoryRead(url: URL) {
  return url.pathname === '/api/recipes' && url.searchParams.has('productId')
    && url.searchParams.has('size') && url.searchParams.get('isActive') === 'true'
    && !url.searchParams.has('page') && !url.searchParams.has('limit')
}
function historySetup(rows: Recipe[] = [refRecipe], handler?: LifecycleHandler) {
  return lifecycleSetup((url, init) => {
    const override = handler?.(url, init)
    if (override !== undefined) return override
    if (init.method !== 'GET') return
    if (url.pathname === '/api/recipes') {
      const filtered = rows.filter(row => (!url.searchParams.has('productId') || row.productId === url.searchParams.get('productId'))
        && (!url.searchParams.has('size') || row.size === url.searchParams.get('size'))
        && (!url.searchParams.has('isActive') || String(row.isActive) === url.searchParams.get('isActive')))
      return lifecycleHistory(filtered, url)
    }
    const recipe = rows.find(row => url.pathname === `/api/recipes/${row._id}`)
    if (recipe) return refJson({ data: recipe })
  })
}
async function historyOpen(user: ReturnType<typeof userEvent.setup>, recipe?: Recipe) {
  await user.click(screen.getByRole('button', { name: 'Recipes' }))
  const opener = recipe
    ? await screen.findByRole('button', { name: `History for recipe ${recipe.size} version ${recipe.version} for ${recipe.productId}` })
    : screen.getByRole('button', { name: 'Browse recipe history' })
  await user.click(opener)
  return { panel: screen.getByRole('region', { name: 'Recipe version history' }), opener }
}
async function historyChoose(panel: HTMLElement, productId = refProductId, size = 'S') {
  await waitFor(() => expect(within(within(panel).getByLabelText('History Product')).getByRole('option', { name: /Picker tea/ })).toBeTruthy())
  fireEvent.change(within(panel).getByLabelText('History Product'), { target: { value: productId } })
  await waitFor(() => expect(within(panel).getByLabelText('History size')).toHaveProperty('disabled', false))
  fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: size } })
}

describe('Recipe version history', () => {
  it('opens contextual history, retains backend order and exact data, and resolves current inactive metadata', async () => {
    const rows = [lifecycleVersion(8, { ingredients: [{ ingredientId: refIngredientId, quantity: '999999999999.999999' }] }),
      lifecycleVersion(2, { isActive: true }), lifecycleVersion(5)]
    const currentIngredient = { ...refIngredient, name: 'Current renamed milk', code: 'CURRENT-MILK', unit: 'g', isActive: false }
    const { user, gets, fetch, posts } = historySetup(rows, (url, init) => {
      if (init.method === 'GET' && url.pathname === `/api/products/${refProductId}`) return refJson({ data: { ...refProduct, isAvailable: false } })
      if (init.method === 'GET' && url.pathname === `/api/ingredients/${refIngredientId}`) return refJson({ data: currentIngredient })
    })
    const { panel } = await historyOpen(user, rows[0])
    const card = await within(panel).findByLabelText('History version 8')
    await within(card).findByText('Current renamed milk')
    expect(within(panel).getByLabelText('History Product')).toHaveProperty('value', refProductId)
    expect(within(panel).getByLabelText('History size')).toHaveProperty('value', 'S')
    expect(within(panel).getAllByLabelText(/^History version /).map(item => item.getAttribute('aria-label')))
      .toEqual(['History version 8', 'History version 2', 'History version 5'])
    expect(within(card).getByText(rows[0]._id)).toBeTruthy()
    expect(within(card).getByText(refIngredientId)).toBeTruthy()
    expect(within(card).getByText('999999999999.999999').textContent).toBe('999999999999.999999')
    expect(card.textContent).toContain('CURRENT-MILK')
    expect(panel.textContent).toMatch(/current reference metadata/i)
    expect(card.textContent).toContain('Current unit: g')
    expect(card.textContent).toContain('Inactive')
    expect(card.textContent).toContain(refMetadata.createdAt)
    expect(card.textContent).toContain(refMetadata.updatedAt)
    expect(within(panel).getByLabelText('History version 2').textContent).toContain('Active')
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    expect(await within(summary).findByText(/Current active Recipe: v2$/)).toBeTruthy()
    const historyReads = gets().filter(isHistoryRead)
    expect(historyReads).toHaveLength(1)
    expect(Object.fromEntries(historyReads[0].searchParams)).toEqual({ productId: refProductId, size: 'S', page: '1', limit: '20' })
    expect(gets().filter(isActiveHistoryRead)).toHaveLength(1)
    expect(posts()).toHaveLength(0)
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(within(panel).queryByRole('button', { name: /activate|deactivate/i })).toBeNull()
  })

  it('allows unavailable Products and offers only sizes resolved through current Product details', async () => {
    const unavailable = { ...refProduct, isAvailable: false, prices: [{ size: 'L', price: '3' }, { size: 'S', price: '1' }] }
    const { user, gets, posts } = historySetup([], (url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === '/api/products') return refPage([{ ...unavailable, prices: [{ size: 'M', price: '2' }] }])
      if (url.pathname === `/api/products/${refProductId}`) return refJson({ data: unavailable })
    })
    const { panel } = await historyOpen(user)
    expect(gets().filter(isHistoryRead)).toHaveLength(0)
    await historyChoose(panel)
    await waitFor(() => expect(within(within(panel).getByLabelText('History size')).getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value).filter(Boolean)).toEqual(['S', 'L']))
    expect(gets().some(url => url.pathname === `/api/products/${refProductId}`)).toBe(true)
    expect(gets().filter(url => url.pathname === '/api/products').every(url => !url.searchParams.has('isAvailable'))).toBe(true)
    expect(await within(panel).findByText(/No (?:Recipe |recipe )?(?:version |versions |history )?(?:found|history|exists|yet)/i)).toBeTruthy()
    expect(posts()).toHaveLength(0)
  })

  it('paginates independently from the directory and resets history to page one on size changes', async () => {
    const rows = Array.from({ length: 45 }, (_, index) => lifecycleVersion(index + 1))
    const { user, gets } = historySetup(rows)
    await user.click(screen.getByRole('button', { name: 'Recipes' }))
    const directory = screen.getByRole('region', { name: 'Recipes directory' })
    await within(directory).findByText('Page 1 of 3')
    await user.click(within(directory).getByRole('button', { name: 'Next' }))
    await within(directory).findByText('Page 2 of 3')
    await user.click(within(directory).getByRole('button', { name: `History for recipe S version 21 for ${refProductId}` }))
    const panel = screen.getByRole('region', { name: 'Recipe version history' })
    await within(panel).findByLabelText('History version 1')
    const before = gets().filter(url => url.pathname === '/api/recipes' && !url.searchParams.has('productId')).length
    await user.click(within(panel).getByRole('button', { name: 'Next history page' }))
    await within(panel).findByLabelText('History version 21')
    expect(within(panel).queryByLabelText('History version 1')).toBeNull()
    expect(within(directory).getByText('Page 2 of 3')).toBeTruthy()
    expect(gets().filter(url => url.pathname === '/api/recipes' && !url.searchParams.has('productId'))).toHaveLength(before)
    const pagination = within(panel).getByLabelText('Recipe history pagination')
    expect(pagination.textContent).toMatch(/page 2 of 3/i)
    await user.click(within(directory).getByRole('button', { name: 'Next' }))
    await within(directory).findByText('Page 3 of 3')
    expect(pagination.textContent).toMatch(/page 2 of 3/i)
    fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: 'L' } })
    await waitFor(() => expect(gets().filter(isHistoryRead).at(-1)?.searchParams.get('size')).toBe('L'))
    expect(gets().filter(isHistoryRead).at(-1)?.searchParams.get('page')).toBe('1')
    expect(within(panel).getByRole('button', { name: 'Previous history page' })).toHaveProperty('disabled', true)
    expect(within(directory).getByText('Page 3 of 3')).toBeTruthy()
  })

  it('clears the old size and resets pagination when the selected Product changes', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => lifecycleVersion(index + 1))
    const second: Product = { ...refProduct, _id: refOtherId, code: 'SECOND', name: 'Second history Product', prices: [{ size: 'M', price: '2' }] }
    const { user, gets } = historySetup(rows, (url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === '/api/products') return refPage([refProduct, second])
      if (url.pathname === `/api/products/${refOtherId}`) return refJson({ data: second })
    })
    const { panel } = await historyOpen(user, rows[0])
    await within(panel).findByLabelText('History version 1')
    await user.click(within(panel).getByRole('button', { name: 'Next history page' }))
    await within(panel).findByLabelText('History version 21')
    fireEvent.change(within(panel).getByLabelText('History Product'), { target: { value: refOtherId } })
    await waitFor(() => expect(within(within(panel).getByLabelText('History size')).getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value).filter(Boolean)).toEqual(['M']))
    expect(within(panel).getByLabelText('History size')).toHaveProperty('value', '')
    expect(within(panel).queryByLabelText('History version 21')).toBeNull()
    fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: 'M' } })
    await waitFor(() => expect(gets().filter(isHistoryRead).at(-1)?.searchParams.get('productId')).toBe(refOtherId))
    expect(gets().filter(isHistoryRead).at(-1)?.searchParams.get('page')).toBe('1')
    expect(gets().filter(isHistoryRead).at(-1)?.searchParams.get('size')).toBe('M')
  })

  it('shows the independently retrieved active version outside the history page without assuming the highest is active', async () => {
    const shown = lifecycleVersion(99), active = lifecycleVersion(2, { isActive: true })
    const otherRows = Array.from({ length: 19 }, (_, index) => lifecycleVersion(index + 10))
    const { user, gets } = historySetup([shown], (url, init) => {
      if (init.method !== 'GET') return
      if (isHistoryRead(url)) return refPage([shown, ...otherRows], 1, 21, 20)
      if (isActiveHistoryRead(url)) return refPage([active])
    })
    const { panel } = await historyOpen(user, shown)
    await within(panel).findByLabelText('History version 99')
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    await waitFor(() => expect(summary.textContent).toContain(active._id))
    expect(within(summary).getByText(/Current active Recipe: v2$/)).toBeTruthy()
    expect(summary.textContent).not.toContain(shown._id)
    expect(within(panel).queryByLabelText('History version 2')).toBeNull()
    expect(gets().filter(isActiveHistoryRead).map(url => Object.fromEntries(url.searchParams)))
      .toEqual([{ productId: refProductId, size: 'S', isActive: 'true' }])
  })

  it('announces no active Recipe independently of an inactive version history', async () => {
    const { user } = historySetup([lifecycleVersion(99)])
    const { panel } = await historyOpen(user, lifecycleVersion(99))
    await within(panel).findByLabelText('History version 99')
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    expect(await within(summary).findByText(/No (?:Recipe is currently active|active Recipe|active recipe)/i)).toBeTruthy()
    expect(summary.textContent).not.toContain(lifecycleVersion(99)._id)
  })

  it('accepts empty historical membership with an explanation while retaining the version and its timestamps', async () => {
    const empty = lifecycleVersion(4, { ingredients: [] })
    const { user, posts } = historySetup([empty])
    const { panel } = await historyOpen(user, empty)
    const card = await within(panel).findByLabelText('History version 4')
    expect(within(card).getByText(/no ingredient|empty.*ingredient/i)).toBeTruthy()
    expect(card.textContent).toContain(empty._id)
    expect(card.textContent).toContain(empty.createdAt)
    expect(card.textContent).toContain(empty.updatedAt)
    expect(within(panel).queryByRole('alert')).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it.each(['multiple', 'inactive', 'wrong-product', 'wrong-size', 'count-mismatch'])('rejects %s active summaries without hiding valid history', async inconsistency => {
    const active = lifecycleVersion(1, { isActive: true })
    const activeRows = inconsistency === 'multiple' ? [active, lifecycleVersion(2, { isActive: true })]
      : [{ ...active, ...(inconsistency === 'inactive' ? { isActive: false }
        : inconsistency === 'wrong-product' ? { productId: refOtherId } : { size: 'L' as const }) }]
    const { user, posts } = historySetup([refRecipe], (url, init) => init.method === 'GET' && isActiveHistoryRead(url)
      ? refPage(inconsistency === 'count-mismatch' ? [] : activeRows, 1, inconsistency === 'count-mismatch' ? 1 : activeRows.length) : undefined)
    const { panel } = await historyOpen(user, refRecipe)
    await within(panel).findByLabelText('History version 3')
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    expect(await within(summary).findByRole('alert')).toBeTruthy()
    expect(within(summary).getByRole('button', { name: 'Retry active version' })).toBeTruthy()
    expect(summary.textContent).not.toContain(active._id)
    expect(posts()).toHaveLength(0)
  })

  it.each(['wrong-product', 'wrong-size', 'duplicate-id', 'duplicate-version', 'wrong-page', 'wrong-limit', 'short-page'])(
    'rejects %s history responses while leaving the independent active result readable', async inconsistency => {
      const active = lifecycleVersion(1, { isActive: true })
      const { user, posts } = historySetup([refRecipe], (url, init) => {
        if (init.method !== 'GET') return
        if (isActiveHistoryRead(url)) return refPage([active])
        if (!isHistoryRead(url)) return
        if (inconsistency === 'wrong-product') return refPage([{ ...refRecipe, productId: refOtherId }], 1, 1, 20)
        if (inconsistency === 'wrong-size') return refPage([{ ...refRecipe, size: 'L' }], 1, 1, 20)
        if (inconsistency === 'duplicate-id') return refPage([refRecipe, refRecipe], 1, 2, 20)
        if (inconsistency === 'duplicate-version') return refPage([refRecipe, lifecycleVersion(3)], 1, 2, 20)
        if (inconsistency === 'wrong-page') return refPage([refRecipe], 2, 1, 20)
        if (inconsistency === 'wrong-limit') return refPage([refRecipe], 1, 1, 10)
        return refPage([refRecipe], 1, 2, 20)
      })
      const { panel } = await historyOpen(user, refRecipe)
      expect(await within(panel).findByRole('button', { name: 'Retry history' })).toBeTruthy()
      expect(within(panel).queryByLabelText('History version 3')).toBeNull()
      const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
      await waitFor(() => expect(summary.textContent).toContain(active._id))
      expect(within(summary).queryByRole('alert')).toBeNull()
      expect(posts()).toHaveLength(0)
    },
  )

  it('reports an active version missing from complete history and clears the warning after fresh agreeing reads', async () => {
    const active = lifecycleVersion(1, { isActive: true })
    let changed = false
    const { user, gets, fetch } = historySetup([refRecipe], (url, init) => {
      if (init.method !== 'GET') return
      if (isActiveHistoryRead(url)) return refPage([active])
      if (isHistoryRead(url)) return lifecycleHistory(changed ? [refRecipe, active] : [refRecipe], url)
    })
    const { panel } = await historyOpen(user, refRecipe)
    await within(panel).findByLabelText('History version 3')
    const warning = await within(panel).findByRole('alert')
    expect(warning.textContent).toContain('Current active status cannot be confirmed')
    expect(within(panel).queryByText('Current active version', { selector: 'strong' })).toBeNull()
    const before = gets().length
    changed = true
    await user.click(within(panel).getByRole('button', { name: 'Refresh history and active version' }))
    const activeCard = await within(panel).findByLabelText('History version 1')
    await within(activeCard).findByText('Current active version')
    expect(within(panel).queryByRole('alert')).toBeNull()
    expect(gets().slice(before).filter(isHistoryRead)).toHaveLength(1)
    expect(gets().slice(before).filter(isActiveHistoryRead)).toHaveLength(1)
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('reports disagreement between active flags and the independently retrieved no-active state', async () => {
    const row = lifecycleVersion(3, { isActive: true })
    const { user } = historySetup([row], (url, init) => init.method === 'GET' && isActiveHistoryRead(url) ? refPage([]) : undefined)
    const { panel } = await historyOpen(user, row)
    const card = await within(panel).findByLabelText('History version 3')
    expect((await within(panel).findByRole('alert')).textContent).toContain('reads disagree')
    expect(card.textContent).toContain('Active at history read')
    expect(within(card).queryByText('Current active version')).toBeNull()
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    expect(summary.textContent).toContain('reported no active Recipe; history disagrees')
  })

  it('keeps history and active failures independent and retries only the requested read', async () => {
    let failHistory = true, failActive = false
    const active = lifecycleVersion(1, { isActive: true })
    const { user, gets } = historySetup([refRecipe], (url, init) => {
      if (init.method !== 'GET') return
      if (isHistoryRead(url) && failHistory) return refJson({ error: 'private SQL history error' }, 500)
      if (isActiveHistoryRead(url)) return failActive ? refJson({ error: 'private SQL active error' }, 500)
        : refPage([{ ...active, size: url.searchParams.get('size') as Recipe['size'] }])
    })
    const { panel } = await historyOpen(user, refRecipe)
    await within(panel).findByRole('button', { name: 'Retry history' })
    let summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    await waitFor(() => expect(summary.textContent).toContain(active._id))
    expect(panel.textContent).not.toContain('private SQL')
    const activeBefore = gets().filter(isActiveHistoryRead).length
    failHistory = false
    await user.click(within(panel).getByRole('button', { name: 'Retry history' }))
    await within(panel).findByLabelText('History version 3')
    expect(gets().filter(isActiveHistoryRead)).toHaveLength(activeBefore)
    failActive = true
    fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: 'L' } })
    summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    await within(summary).findByRole('button', { name: 'Retry active version' })
    const historyBefore = gets().filter(isHistoryRead).length
    failActive = false
    await user.click(within(summary).getByRole('button', { name: 'Retry active version' }))
    await waitFor(() => expect(summary.textContent).toContain(active._id))
    expect(within(summary).queryByRole('alert')).toBeNull()
    expect(gets().filter(isHistoryRead)).toHaveLength(historyBefore)
    expect(panel.textContent).not.toContain('private SQL')
  })

  it('preserves raw UUIDs and exact quantities when references fail, with independent read retries', async () => {
    let failProduct = true, failIngredient = true
    const { user, gets, posts } = historySetup([refRecipe], (url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === `/api/products/${refProductId}` && failProduct) return refJson({ error: 'hidden product database detail' }, 500)
      if (url.pathname === `/api/ingredients/${refIngredientId}` && failIngredient) return refJson({ error: 'hidden ingredient database detail' }, 500)
    })
    const { panel } = await historyOpen(user, refRecipe)
    const card = await within(panel).findByLabelText('History version 3')
    await within(panel).findByRole('button', { name: 'Retry Product details' })
    await within(card).findByRole('button', { name: `Retry Ingredient ${refIngredientId}` })
    expect(panel.textContent).toContain(refProductId)
    expect(within(card).getByText(refIngredientId)).toBeTruthy()
    expect(within(card).getByText('1.25')).toBeTruthy()
    expect(panel.textContent).not.toContain('database detail')
    const historiesBefore = gets().filter(isHistoryRead).length
    const ingredientBefore = gets().filter(url => url.pathname === `/api/ingredients/${refIngredientId}`).length
    failProduct = false
    await user.click(within(panel).getByRole('button', { name: 'Retry Product details' }))
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Retry Product details' })).toBeNull())
    expect(gets().filter(isHistoryRead)).toHaveLength(historiesBefore)
    expect(gets().filter(url => url.pathname === `/api/ingredients/${refIngredientId}`)).toHaveLength(ingredientBefore)
    const productBefore = gets().filter(url => url.pathname === `/api/products/${refProductId}`).length
    failIngredient = false
    await user.click(within(card).getByRole('button', { name: `Retry Ingredient ${refIngredientId}` }))
    await within(card).findByText('Picker milk')
    expect(gets().filter(url => url.pathname === `/api/products/${refProductId}`)).toHaveLength(productBefore)
    expect(gets().filter(isHistoryRead)).toHaveLength(historiesBefore)
    expect(posts()).toHaveLength(0)
  })

  it.each(['success', 'failure'])('ignores stale history and active %s responses after the size changes', async outcome => {
    const oldHistory = refDeferred<Response>(), oldActive = refDeferred<Response>()
    const current = lifecycleVersion(7, { size: 'L' }), active = lifecycleVersion(2, { size: 'L', isActive: true })
    const { user } = historySetup([refRecipe], (url, init) => {
      if (init.method !== 'GET') return
      if (isHistoryRead(url)) return url.searchParams.get('size') === 'S' ? oldHistory.promise : refPage([current, active], 1, 2, 20)
      if (isActiveHistoryRead(url)) return url.searchParams.get('size') === 'S' ? oldActive.promise : refPage([active])
    })
    const { panel } = await historyOpen(user, refRecipe)
    await waitFor(() => expect(within(panel).getByLabelText('History size')).toHaveProperty('disabled', false))
    fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: 'L' } })
    await within(panel).findByLabelText('History version 7')
    const summary = within(panel).getByRole('region', { name: 'Current active Recipe' })
    await waitFor(() => expect(summary.textContent).toContain(active._id))
    await act(async () => {
      if (outcome === 'success') {
        oldHistory.resolve(refPage([lifecycleVersion(90)], 1, 1, 20))
        oldActive.resolve(refPage([lifecycleVersion(91, { isActive: true })]))
      } else {
        oldHistory.reject(new Error('late history failure'))
        oldActive.reject(new Error('late active failure'))
      }
    })
    expect(within(panel).getByLabelText('History version 7')).toBeTruthy()
    expect(within(panel).queryByLabelText('History version 90')).toBeNull()
    expect(summary.textContent).toContain(active._id)
    expect(summary.textContent).not.toContain(lifecycleVersion(91)._id)
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  it('ignores stale Product detail responses and retains the newer supported sizes', async () => {
    const pending = refDeferred<Response>()
    const second: Product = { ...refProduct, _id: refOtherId, name: 'New history Product', code: 'NEW-HISTORY', prices: [{ size: 'M', price: '2' }] }
    const { user } = historySetup([], (url, init) => {
      if (init.method !== 'GET') return
      if (url.pathname === '/api/products') return refPage([refProduct, second])
      if (url.pathname === `/api/products/${refProductId}`) return pending.promise
      if (url.pathname === `/api/products/${refOtherId}`) return refJson({ data: second })
    })
    const { panel } = await historyOpen(user)
    const product = within(panel).getByLabelText('History Product')
    await within(product).findByRole('option', { name: /Picker tea/ })
    fireEvent.change(product, { target: { value: refProductId } })
    fireEvent.change(product, { target: { value: refOtherId } })
    const sizes = await within(panel).findByLabelText('History size')
    await waitFor(() => expect(within(sizes).getAllByRole('option').map(option => (option as HTMLOptionElement).value).filter(Boolean)).toEqual(['M']))
    await act(async () => pending.resolve(refJson({ data: { ...refProduct, name: 'Stale history Product' } })))
    expect(product).toHaveProperty('value', refOtherId)
    expect(within(sizes).getAllByRole('option').map(option => (option as HTMLOptionElement).value).filter(Boolean)).toEqual(['M'])
    expect(panel.textContent).not.toContain('Stale history Product')
  })

  it('ignores stale Ingredient metadata when a new history context replaces its membership', async () => {
    const pending = refDeferred<Response>()
    const newer = lifecycleVersion(7, { size: 'L', ingredients: [{ ingredientId: refOtherId, quantity: '0.000001' }] })
    const { user } = historySetup([refRecipe], (url, init) => {
      if (init.method !== 'GET') return
      if (isHistoryRead(url) && url.searchParams.get('size') === 'L') return refPage([newer], 1, 1, 20)
      if (url.pathname === `/api/ingredients/${refIngredientId}`) return pending.promise
    })
    const { panel } = await historyOpen(user, refRecipe)
    await within(panel).findByLabelText('History version 3')
    await waitFor(() => expect(within(panel).getByLabelText('History size')).toHaveProperty('disabled', false))
    fireEvent.change(within(panel).getByLabelText('History size'), { target: { value: 'L' } })
    const card = await within(panel).findByLabelText('History version 7')
    await within(card).findByText('Picker sugar')
    await act(async () => pending.resolve(refJson({ data: { ...refIngredient, name: 'Stale historical Ingredient' } })))
    expect(panel.textContent).not.toContain('Stale historical Ingredient')
    expect(within(panel).queryByLabelText('History version 3')).toBeNull()
    expect(within(card).getByText('0.000001')).toBeTruthy()
  })

  it('refreshes and resets affected history after confirmed creation while preserving directory filters', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => lifecycleVersion(index + 1))
    const created = lifecycleVersion(22), active = lifecycleVersion(1, { isActive: true })
    let confirmed = false
    const { user, gets, posts } = lifecycleSetup((url, init) => {
      if (init.method === 'POST') { confirmed = true; return refJson({ data: created }, 201) }
      if (init.method !== 'GET') return
      if (isActiveHistoryRead(url)) return refPage([active])
      if (url.pathname === '/api/recipes') return lifecycleHistory(confirmed ? [created, ...rows] : rows, url)
      if (url.pathname === `/api/recipes/${created._id}`) return refJson({ data: created })
    })
    const { panel } = await historyOpen(user)
    await historyChoose(panel)
    await within(panel).findByLabelText('History version 1')
    await user.click(within(panel).getByRole('button', { name: 'Next history page' }))
    await within(panel).findByLabelText('History version 21')
    const directory = screen.getByRole('region', { name: 'Recipes directory' })
    fireEvent.change(within(directory).getByLabelText('Status'), { target: { value: 'false' } })
    fireEvent.change(within(directory).getByLabelText('Rows per page'), { target: { value: '10' } })
    await user.click(within(directory).getByRole('button', { name: 'Apply filters' }))
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    const form = screen.getByRole('form', { name: 'Create recipe' })
    await lifecycleFill(user, form)
    const before = gets().length
    lifecycleSubmit(form)
    await screen.findByText(/Recipe version 22 created successfully/)
    const refreshed = screen.getByRole('region', { name: 'Recipe version history' })
    await within(refreshed).findByLabelText('History version 22')
    expect(within(refreshed).getByLabelText('Recipe history pagination').textContent).toMatch(/page 1 of 2/i)
    expect(within(refreshed).getByLabelText('History Product')).toHaveProperty('value', refProductId)
    expect(within(refreshed).getByLabelText('History size')).toHaveProperty('value', 'S')
    expect(gets().slice(before).filter(isHistoryRead).at(-1)?.searchParams.get('page')).toBe('1')
    expect(gets().slice(before).some(isActiveHistoryRead)).toBe(true)
    expect(gets().slice(before).some(url => url.pathname === `/api/recipes/${created._id}`)).toBe(true)
    expect(gets().slice(before).some(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '10'
      && url.searchParams.get('isActive') === 'false')).toBe(true)
    expect(within(directory).getByLabelText('Status')).toHaveProperty('value', 'false')
    expect(posts()).toHaveLength(1)
    const details = screen.getByRole('region', { name: 'Record details' })
    await within(details).findByText(created._id)
  })

  it.each(['global', 'contextual'])('provides accessible %s controls and restores opening focus without mutation', async entry => {
    const { user, fetch } = historySetup([refRecipe])
    const { panel, opener } = await historyOpen(user, entry === 'contextual' ? refRecipe : undefined)
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Recipe version history' }))
    expect(within(panel).getByRole('combobox', { name: 'History Product' })).toBeTruthy()
    if (entry === 'global') await historyChoose(panel)
    else await within(panel).findByLabelText('History size')
    expect(within(panel).getByRole('combobox', { name: 'History size' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Previous history page' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Next history page' })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Close recipe history' }))
    expect(screen.queryByRole('region', { name: 'Recipe version history' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('refocuses already-open history on directory entry and restores the history detail action after viewing', async () => {
    const { user, fetch } = historySetup([refRecipe])
    const { panel } = await historyOpen(user, refRecipe)
    const card = await within(panel).findByLabelText('History version 3')
    const action = within(card).getByRole('button', { name: 'View details for version 3' })
    await user.click(action)
    const details = await screen.findByRole('region', { name: 'Record details' })
    await within(details).findByText(refRecipe._id)
    expect(document.activeElement).toBe(within(details).getByRole('heading', { name: 'Record details' }))
    await user.click(within(details).getByRole('button', { name: 'Close details' }))
    expect(document.activeElement).toBe(action)
    const contextual = screen.getByRole('button', { name: `History for recipe S version 3 for ${refProductId}` })
    await user.click(contextual)
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Recipe version history' }))
    await user.click(within(panel).getByRole('button', { name: 'Close recipe history' }))
    expect(document.activeElement).toBe(contextual)
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })
})

interface RecipeActionServer {
  rows: Recipe[]
  product: Product
  ingredients: Ingredient[]
}
type RecipeActionHandler = (url: URL, init: RequestInit, server: RecipeActionServer) => Response | Promise<Response> | undefined
function recipeActionSetup(rows: Recipe[], handler?: RecipeActionHandler, timeoutMs = 5_000) {
  const server: RecipeActionServer = { rows: rows.map(row => ({ ...row, ingredients: row.ingredients.map(item => ({ ...item })) })),
    product: { ...refProduct }, ingredients: [{ ...refIngredient }, { ...refOther }] }
  const setup = lifecycleSetup((url, init) => {
    const override = handler?.(url, init, server)
    if (override !== undefined) return override
    if (init.method === 'GET') {
      if (url.pathname === '/api/products') return lifecycleHistoryProducts(server.product, url)
      if (url.pathname === `/api/products/${refProductId}`) return refJson({ data: server.product })
      const ingredient = server.ingredients.find(row => url.pathname === `/api/ingredients/${row._id}`)
      if (ingredient) return refJson({ data: ingredient })
      if (url.pathname === '/api/recipes') {
        const matches = server.rows.filter(row => (!url.searchParams.has('productId') || row.productId === url.searchParams.get('productId'))
          && (!url.searchParams.has('size') || row.size === url.searchParams.get('size'))
          && (!url.searchParams.has('isActive') || String(row.isActive) === url.searchParams.get('isActive')))
        return lifecycleHistory(matches, url)
      }
      const recipe = server.rows.find(row => url.pathname === `/api/recipes/${row._id}`)
      if (recipe) return refJson({ data: recipe })
    }
    if (init.method === 'POST') {
      const match = /^\/api\/recipes\/([^/]+)\/(activate|deactivate)$/.exec(url.pathname)
      if (match) {
        const target = server.rows.find(row => row._id === match[1])
        if (!target) return refJson({ error: 'Not found' }, 404)
        server.rows = server.rows.map(row => {
          if (row._id === target._id) return { ...row, isActive: match[2] === 'activate', updatedAt: '2026-11-05T01:00:00.000Z' }
          if (match[2] === 'activate' && row.productId === target.productId && row.size === target.size) return { ...row, isActive: false }
          return row
        })
        return refJson({ data: server.rows.find(row => row._id === target._id) })
      }
    }
  }, timeoutMs)
  return { ...setup, server, actionPosts: () => setup.fetch.mock.calls.filter(([input, init]) => init?.method === 'POST'
    && /\/(?:activate|deactivate)$/.test(new URL(String(input)).pathname)) }
}
function lifecycleHistoryProducts(product: Product, url: URL) {
  return refPage([product], +(url.searchParams.get('page') ?? '1'), 1, +(url.searchParams.get('limit') ?? '20'))
}
async function recipeActionOpen(user: ReturnType<typeof userEvent.setup>, recipe: Recipe, action: 'activate' | 'deactivate' = 'activate') {
  const { panel } = await historyOpen(user, recipe)
  await within(panel).findByLabelText(`History version ${recipe.version}`)
  await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
  const opener = within(panel).getByRole('button', { name: `${action === 'activate' ? 'Activate' : 'Deactivate'} version ${recipe.version}` })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
  return { panel, opener, dialog }
}
function recipeActionConfirm(dialog: HTMLElement, action: 'activate' | 'deactivate' = 'activate') {
  return within(dialog).getByRole('button', { name: action === 'activate' ? 'Confirm activation' : 'Confirm deactivation' })
}

describe('Recipe activation and deactivation', () => {
  it('activates an eligible inactive Recipe with the exact bodyless, queryless endpoint after explicit confirmation', async () => {
    const target = lifecycleVersion(3)
    const { user, server, actionPosts, gets } = recipeActionSetup([target])
    const { panel, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    expect(dialog.textContent).toContain(target._id)
    expect(dialog.textContent).toContain(refProductId)
    expect(dialog.textContent).toContain('Picker tea')
    expect(dialog.textContent).toMatch(/version 3|v3/i)
    expect(dialog.textContent).toMatch(/no active/i)
    expect(actionPosts()).toHaveLength(0)
    const before = gets().length
    await user.click(recipeActionConfirm(dialog))
    await waitFor(() => expect(actionPosts()).toHaveLength(1))
    const [input, init] = actionPosts()[0]
    expect(String(input)).toBe(`http://127.0.0.1:5000/api/recipes/${target._id}/activate`)
    expect(init?.body).toBeUndefined()
    expect(init?.headers).not.toHaveProperty('Content-Type')
    expect(server.rows[0].isActive).toBe(true)
    expect(server.rows[0].version).toBe(target.version)
    expect(server.rows[0].ingredients).toEqual(target.ingredients)
    await waitFor(() => expect(within(panel).getByLabelText('History version 3').textContent).toContain('Current active version'))
    expect(gets().slice(before).some(url => url.pathname === `/api/recipes/${target._id}`)).toBe(true)
    expect(gets().slice(before).some(isHistoryRead)).toBe(true)
    expect(gets().slice(before).some(isActiveHistoryRead)).toBe(true)
  })

  it('deactivates the current active Recipe without changing immutable version contents', async () => {
    const target = lifecycleVersion(3, { isActive: true })
    const { user, server, actionPosts } = recipeActionSetup([target, lifecycleVersion(8)])
    const { panel, dialog } = await recipeActionOpen(user, target, 'deactivate')
    await waitFor(() => expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', false))
    expect(dialog.textContent).toMatch(/clear|no active/i)
    expect(actionPosts()).toHaveLength(0)
    await user.click(recipeActionConfirm(dialog, 'deactivate'))
    await waitFor(() => expect(actionPosts()).toHaveLength(1))
    const [input, init] = actionPosts()[0]
    expect(String(input)).toBe(`http://127.0.0.1:5000/api/recipes/${target._id}/deactivate`)
    expect(init?.body).toBeUndefined()
    expect(server.rows.find(row => row._id === target._id)?.ingredients).toEqual(target.ingredients)
    expect(server.rows.find(row => row._id === target._id)?.version).toBe(3)
    const active = within(panel).getByRole('region', { name: 'Current active Recipe' })
    await within(active).findByText(/No Recipe is currently active/)
    await waitFor(() => expect(within(panel).getByLabelText('History version 3').textContent).toContain('Inactive at history read'))
  })

  it.each([2, 9])('activates version %s and replaces the current pointer regardless of version order', async version => {
    const target = lifecycleVersion(version), previous = lifecycleVersion(5, { isActive: true })
    const { user, server, actionPosts } = recipeActionSetup([lifecycleVersion(10), target, previous])
    const { panel, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    expect(dialog.textContent).toMatch(/replac/i)
    expect(dialog.textContent).toMatch(/version 5|v5/i)
    if (version < previous.version) expect(dialog.textContent).toMatch(/older|version numbers do not restrict/i)
    await user.click(recipeActionConfirm(dialog))
    await waitFor(() => expect(server.rows.find(row => row._id === target._id)?.isActive).toBe(true))
    expect(server.rows.find(row => row._id === previous._id)?.isActive).toBe(false)
    expect(server.rows.filter(row => row.isActive)).toHaveLength(1)
    await waitFor(() => expect(within(panel).getByLabelText(`History version ${version}`).textContent).toContain('Current active version'))
    expect(actionPosts()).toHaveLength(1)
  })

  it('cancels confirmation without a mutation and restores the contextual action focus', async () => {
    const target = lifecycleVersion(3)
    const { user, actionPosts } = recipeActionSetup([target])
    const { opener, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Recipe action' }))
    expect(screen.queryByRole('dialog', { name: 'Recipe lifecycle confirmation' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(actionPosts()).toHaveLength(0)
  })

  it.each(['unavailable-product', 'missing-product', 'inactive-ingredient', 'missing-ingredient', 'failed-reference'])(
    'blocks activation when fresh reads establish %s', async failure => {
      const target = lifecycleVersion(3)
      let checking = false
      const { user, actionPosts } = recipeActionSetup([target], (url, init) => {
        if (!checking || init.method !== 'GET') return
        if (url.pathname === `/api/products/${refProductId}`) {
          if (failure === 'unavailable-product') return refJson({ data: { ...refProduct, isAvailable: false } })
          if (failure === 'missing-product') return refJson({ error: 'Not found' }, 404)
        }
        if (url.pathname === `/api/ingredients/${refIngredientId}`) {
          if (failure === 'inactive-ingredient') return refJson({ data: { ...refIngredient, isActive: false } })
          if (failure === 'missing-ingredient') return refJson({ error: 'Not found' }, 404)
          if (failure === 'failed-reference') return refJson({ error: 'private ingredient error' }, 500)
        }
      })
      const { panel } = await historyOpen(user, target)
      await within(panel).findByLabelText('History version 3')
      await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
      checking = true
      await user.click(within(panel).getByRole('button', { name: 'Activate version 3' }))
      const dialog = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
      expect((await within(dialog).findAllByRole('alert')).length).toBeGreaterThan(0)
      expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
      expect(dialog.textContent).not.toContain('private ingredient error')
      fireEvent.click(recipeActionConfirm(dialog))
      expect(actionPosts()).toHaveLength(0)
    })

  it('keeps empty historical membership readable and explicitly disables activation', async () => {
    const target = lifecycleVersion(3, { ingredients: [] })
    const { user, actionPosts } = recipeActionSetup([target])
    const { panel } = await historyOpen(user, target)
    const card = await within(panel).findByLabelText('History version 3')
    await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
    expect(within(card).getByRole('button', { name: 'Activate version 3' })).toHaveProperty('disabled', true)
    expect(card.textContent).toMatch(/cannot be activated.*no Ingredient membership/i)
    expect(actionPosts()).toHaveLength(0)
  })

  it.each(['unavailable-product', 'inactive-ingredient', 'missing-references', 'empty-membership'])(
    'allows active Recipe deactivation despite %s', async unavailable => {
      const target = lifecycleVersion(3, { isActive: true, ...(unavailable === 'empty-membership' ? { ingredients: [] } : {}) })
      const { user, server, actionPosts } = recipeActionSetup([target], (url, init) => {
        if (init.method !== 'GET') return
        if (url.pathname === `/api/products/${refProductId}` && unavailable === 'unavailable-product') return refJson({ data: { ...refProduct, isAvailable: false } })
        if (url.pathname === `/api/ingredients/${refIngredientId}` && unavailable === 'inactive-ingredient') return refJson({ data: { ...refIngredient, isActive: false } })
        if (unavailable === 'missing-references' && [ `/api/products/${refProductId}`, `/api/ingredients/${refIngredientId}` ].includes(url.pathname)) return refJson({ error: 'Not found' }, 404)
      })
      const { dialog } = await recipeActionOpen(user, target, 'deactivate')
      await waitFor(() => expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', false))
      await user.click(recipeActionConfirm(dialog, 'deactivate'))
      await waitFor(() => expect(actionPosts()).toHaveLength(1))
      await waitFor(() => expect(server.rows[0].isActive).toBe(false))
      expect(actionPosts()).toHaveLength(1)
    })

  it('rechecks fresh target, references, active state and every history page before sending the action', async () => {
    const target = lifecycleVersion(1)
    const rows = [target, ...Array.from({ length: 101 }, (_, index) => lifecycleVersion(index + 2))]
    const { user, gets, actionPosts } = recipeActionSetup(rows)
    const { dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    const before = gets().length
    expect(gets().filter(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100'
      && url.searchParams.get('page') === '2')).toHaveLength(1)
    await user.click(recipeActionConfirm(dialog))
    await waitFor(() => expect(actionPosts()).toHaveLength(1))
    const rechecks = gets().slice(before)
    expect(rechecks.some(url => url.pathname === `/api/recipes/${target._id}`)).toBe(true)
    expect(rechecks.some(url => url.pathname === `/api/products/${target.productId}`)).toBe(true)
    expect(rechecks.some(url => url.pathname === `/api/ingredients/${refIngredientId}`)).toBe(true)
    expect(rechecks.some(isActiveHistoryRead)).toBe(true)
    const allHistory = rechecks.filter(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100')
    expect(allHistory.some(url => url.searchParams.get('page') === '2')).toBe(true)
    expect(allHistory.every(url => !url.searchParams.has('isActive'))).toBe(true)
  })

  it.each(['quantity', 'active-pointer', 'new-version', 'ingredient-metadata'])(
    'requires another explicit confirmation after %s changes during review', async change => {
      const target = lifecycleVersion(3), oldActive = lifecycleVersion(1, { isActive: true })
      const { user, server, actionPosts } = recipeActionSetup([target, oldActive])
      const { dialog } = await recipeActionOpen(user, target)
      await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
      if (change === 'quantity') server.rows = server.rows.map(row => row._id === target._id
        ? { ...row, ingredients: [{ ingredientId: refIngredientId, quantity: '2.000001' }] } : row)
      if (change === 'active-pointer') server.rows = [target, { ...oldActive, isActive: false }, lifecycleVersion(2, { isActive: true })]
      if (change === 'new-version') server.rows = [...server.rows, lifecycleVersion(4)]
      if (change === 'ingredient-metadata') server.ingredients = server.ingredients.map(row => ({ ...row, name: 'Fresh Ingredient name' }))
      await user.click(recipeActionConfirm(dialog))
      await within(dialog).findByText(/Server state changed.*No mutation request was sent/)
      expect(actionPosts()).toHaveLength(0)
      expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false)
      if (change === 'quantity') expect(within(dialog).getByText('2.000001')).toBeTruthy()
      if (change === 'ingredient-metadata') expect(within(dialog).getByText('Fresh Ingredient name')).toBeTruthy()
      await user.click(recipeActionConfirm(dialog))
      await waitFor(() => expect(actionPosts()).toHaveLength(1))
      expect(server.rows.find(row => row._id === target._id)?.isActive).toBe(true)
    })

  it.each(['unavailable-product', 'inactive-ingredient', 'already-active'])(
    'blocks a stale activation confirmation after fresh state becomes %s', async change => {
      const target = lifecycleVersion(3)
      const { user, server, actionPosts } = recipeActionSetup([target])
      const { dialog } = await recipeActionOpen(user, target)
      await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
      if (change === 'unavailable-product') server.product.isAvailable = false
      if (change === 'inactive-ingredient') server.ingredients[0].isActive = false
      if (change === 'already-active') server.rows[0].isActive = true
      await user.click(recipeActionConfirm(dialog))
      await within(dialog).findByText(/Server state changed.*No mutation request was sent/)
      expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
      expect(actionPosts()).toHaveLength(0)
    })

  it('does not deactivate a different active version after the reviewed target becomes inactive', async () => {
    const target = lifecycleVersion(3, { isActive: true }), other = lifecycleVersion(5)
    const { user, server, actionPosts } = recipeActionSetup([target, other])
    const { dialog } = await recipeActionOpen(user, target, 'deactivate')
    await waitFor(() => expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', false))
    server.rows = [{ ...target, isActive: false }, { ...other, isActive: true }]
    await user.click(recipeActionConfirm(dialog, 'deactivate'))
    await within(dialog).findByText(/different active version will not be deactivated/)
    expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', true)
    expect(server.rows.find(row => row._id === other._id)?.isActive).toBe(true)
    expect(actionPosts()).toHaveLength(0)
  })

  it('takes a synchronous confirmation lock and shows no optimistic active badge while POST is pending', async () => {
    const target = lifecycleVersion(3), pending = refDeferred<Response>()
    const { user, actionPosts } = recipeActionSetup([target], (_url, init) => init.method === 'POST' ? pending.promise : undefined)
    const { panel, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    fireEvent.click(recipeActionConfirm(dialog)); fireEvent.click(recipeActionConfirm(dialog))
    await waitFor(() => expect(actionPosts()).toHaveLength(1))
    fireEvent.click(recipeActionConfirm(dialog)); fireEvent.click(recipeActionConfirm(dialog))
    expect(actionPosts()).toHaveLength(1)
    expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
    expect(within(panel).getByLabelText('History version 3').textContent).toContain('Inactive at history read')
    expect(within(panel).getByLabelText('History version 3').textContent).not.toContain('Current active version')
    expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'New recipe' })).toHaveProperty('disabled', true)
    expect(within(dialog).getByRole('button', { name: 'Cancel Recipe action' })).toHaveProperty('disabled', true)
    await act(async () => pending.resolve(refJson({ data: { ...target, isActive: true } })))
    expect(actionPosts()).toHaveLength(1)
  })

  it('blocks an already-open creation form while a lifecycle request owns the shared lock', async () => {
    const target = lifecycleVersion(3), pending = refDeferred<Response>()
    const { user, posts, actionPosts } = recipeActionSetup([target], (_url, init) => init.method === 'POST' ? pending.promise : undefined)
    const form = await lifecycleOpen(user)
    await lifecycleFill(user, form)
    const { dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    lifecycleSubmit(form)
    expect(posts()).toHaveLength(0)
    await user.click(recipeActionConfirm(dialog))
    await waitFor(() => expect(actionPosts()).toHaveLength(1))
    lifecycleSubmit(form); lifecycleSubmit(form)
    expect(posts()).toHaveLength(1)
    expect(within(form).getByLabelText('Quantity 1')).toHaveProperty('value', '0001.250000')
    await act(async () => pending.resolve(refJson({ data: { ...target, isActive: true } })))
  })

  it('blocks lifecycle actions synchronously while Recipe creation is in preflight', async () => {
    const target = lifecycleVersion(3), pending = refDeferred<Response>()
    let submitting = false
    const { user, posts, actionPosts } = recipeActionSetup([target], (url, init) => submitting && init.method === 'GET'
      && url.pathname === `/api/products/${refProductId}` ? pending.promise : undefined)
    const { panel } = await historyOpen(user, target)
    await within(panel).findByLabelText('History version 3')
    await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
    await user.click(screen.getByRole('button', { name: 'New recipe' }))
    const form = screen.getByRole('form', { name: 'Create recipe' })
    await lifecycleFill(user, form)
    submitting = true
    lifecycleSubmit(form)
    expect(within(panel).getByRole('button', { name: 'Activate version 3' })).toHaveProperty('disabled', true)
    fireEvent.click(within(panel).getByRole('button', { name: 'Activate version 3' }))
    expect(actionPosts()).toHaveLength(0)
    expect(screen.queryByRole('dialog', { name: 'Recipe lifecycle confirmation' })).toBeNull()
    expect(posts()).toHaveLength(0)
    // A missing refreshed reference makes preflight fail without adding any creation mutation.
    await act(async () => pending.resolve(refJson({ error: 'Not found' }, 404)))
    await screen.findByText(/Preflight failed.*No creation request was sent/)
    expect(posts()).toHaveLength(0)
  })

  it.each([400, 404, 409])('reports HTTP %s rejection without retrying or retaining an uncertain mutation lock', async status => {
    const target = lifecycleVersion(3)
    const { user, actionPosts } = recipeActionSetup([target], (_url, init) => init.method === 'POST'
      ? refJson({ error: 'private backend rejection' }, status) : undefined)
    const { dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog))
    await within(dialog).findByText(/operation was rejected/i)
    expect(actionPosts()).toHaveLength(1)
    expect(dialog.textContent).not.toContain('private backend rejection')
    expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', false)
    fireEvent.click(recipeActionConfirm(dialog))
    expect(actionPosts()).toHaveLength(1)
  })

  it.each(['network', 'timeout', 'server', 'malformed-success', 'unexpected-active', 'unexpected-quantity'])(
    'preserves an uncertain %s operation and blocks further Recipe mutations without automatic retry', async failure => {
      const target = lifecycleVersion(3), pending = refDeferred<Response>()
      const { user, actionPosts, gets } = recipeActionSetup([target], (_url, init) => {
        if (init.method !== 'POST') return
        if (failure === 'network') throw new Error('mock unknown network outcome')
        if (failure === 'timeout') return pending.promise
        if (failure === 'server') return refJson({ error: 'private SQL lifecycle failure' }, 500)
        if (failure === 'malformed-success') return refJson({ data: { unexpected: true } })
        if (failure === 'unexpected-active') return refJson({ data: target })
        return refJson({ data: { ...target, isActive: true, ingredients: [{ ingredientId: refIngredientId, quantity: '1.250001' }] } })
      }, failure === 'timeout' ? 150 : 5_000)
      const { panel, dialog } = await recipeActionOpen(user, target)
      await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
      await user.click(recipeActionConfirm(dialog))
      await within(dialog).findByText(/lifecycle outcome is unknown/i)
      expect(dialog.textContent).toContain(target._id)
      expect(dialog.textContent).not.toContain('private SQL lifecycle failure')
      expect(within(dialog).getByRole('button', { name: 'Refresh server state' })).toBeTruthy()
      expect(within(dialog).getByRole('button', { name: 'Cancel Recipe action' })).toHaveProperty('disabled', true)
      expect(screen.getByRole('button', { name: 'New recipe' })).toHaveProperty('disabled', true)
      expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', true)
      expect(within(panel).getByRole('button', { name: 'Activate version 3' })).toHaveProperty('disabled', true)
      fireEvent.click(recipeActionConfirm(dialog)); fireEvent.click(recipeActionConfirm(dialog))
      expect(actionPosts()).toHaveLength(1)
      const reads = gets().length
      if (failure === 'timeout') await act(async () => pending.resolve(refJson({ data: { ...target, isActive: true } })))
      else await act(async () => Promise.resolve())
      expect(gets()).toHaveLength(reads)
      expect(actionPosts()).toHaveLength(1)
      expect(within(dialog).getByText(/lifecycle outcome is unknown/i)).toBeTruthy()
    })

  it('reconciles an uncertain operation through GETs and requires fresh confirmation for a subsequent action', async () => {
    const target = lifecycleVersion(3)
    let submissions = 0
    const { user, actionPosts, gets } = recipeActionSetup([target], (_url, init, server) => {
      if (init.method !== 'POST' || ++submissions > 1) return
      server.rows = server.rows.map(row => ({ ...row, isActive: row._id === target._id }))
      return refJson({ error: 'Response unavailable after possible application' }, 500)
    })
    const { panel, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog))
    await within(dialog).findByText(/lifecycle outcome is unknown/i)
    const before = gets().length
    await user.click(within(dialog).getByRole('button', { name: 'Refresh server state' }))
    await within(dialog).findByText(/Server state was observed after refresh/)
    expect(dialog.textContent).toMatch(/observations do not establish which request or actor caused this state/i)
    expect(gets().slice(before).some(url => url.pathname === `/api/recipes/${target._id}`)).toBe(true)
    expect(gets().slice(before).some(url => url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100')).toBe(true)
    expect(gets().slice(before).some(isActiveHistoryRead)).toBe(true)
    expect(actionPosts()).toHaveLength(1)
    expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
    const deactivate = await within(panel).findByRole('button', { name: 'Deactivate version 3' })
    await user.click(deactivate)
    const nextDialog = screen.getByRole('dialog', { name: 'Recipe lifecycle confirmation' })
    await waitFor(() => expect(recipeActionConfirm(nextDialog, 'deactivate')).toHaveProperty('disabled', false))
    expect(actionPosts()).toHaveLength(1)
    await user.click(recipeActionConfirm(nextDialog, 'deactivate'))
    await waitFor(() => expect(actionPosts()).toHaveLength(2))
  })

  it('retains the uncertain lock after incomplete reconciliation and retries reads only on request', async () => {
    const target = lifecycleVersion(3)
    let failReads = false
    const { user, actionPosts, gets } = recipeActionSetup([target], (url, init) => {
      if (init.method === 'POST') return refJson({ error: 'Unknown server outcome' }, 500)
      if (failReads && init.method === 'GET' && url.pathname === `/api/recipes/${target._id}`) return refJson({ error: 'Cannot read target' }, 500)
    })
    const { dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog))
    await within(dialog).findByText(/lifecycle outcome is unknown/i)
    failReads = true
    const before = gets().length
    await user.click(within(dialog).getByRole('button', { name: 'Refresh server state' }))
    await within(dialog).findByText(/could not be fully reconciled.*mutations remain blocked/i)
    expect(gets().length).toBeGreaterThan(before)
    expect(actionPosts()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'New recipe' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', true)
    expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
    failReads = false
    await user.click(within(dialog).getByRole('button', { name: 'Refresh server state' }))
    await within(dialog).findByText(/Server state was observed after refresh/)
    expect(actionPosts()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Products' })).toHaveProperty('disabled', false)
  })

  it('remembers confirmed success when refresh fails and offers a GET-only recovery', async () => {
    const target = lifecycleVersion(3)
    let failedRefresh = false
    const { user, actionPosts, gets, fetch } = recipeActionSetup([target], (url, init) => {
      if (init.method === 'POST') { failedRefresh = true; return }
      if (failedRefresh && init.method === 'GET' && url.pathname === `/api/recipes/${target._id}`) return refJson({ error: 'Read failed after mutation' }, 500)
    })
    const { dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog))
    await within(dialog).findByText(/operation was confirmed, but displayed data may be outdated/i)
    expect(within(dialog).getByText(/operation was confirmed by the server/i)).toBeTruthy()
    expect(actionPosts()).toHaveLength(1)
    expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
    const before = gets().length, requestCount = fetch.mock.calls.length
    failedRefresh = false
    await user.click(within(dialog).getByRole('button', { name: 'Refresh server state' }))
    await within(dialog).findByText(/operation was confirmed\. Server reads have been refreshed/i)
    expect(gets().length).toBeGreaterThan(before)
    expect(fetch.mock.calls.slice(requestCount).every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(actionPosts()).toHaveLength(1)
  })

  it('ignores a stale selected-detail response after confirmed activation refreshes all Recipe views', async () => {
    const target = lifecycleVersion(3), pending = refDeferred<Response>()
    let detailReads = 0
    const { user, actionPosts } = recipeActionSetup([target], (url, init) => init.method === 'GET'
      && url.pathname === `/api/recipes/${target._id}` && ++detailReads === 1 ? pending.promise : undefined)
    const { panel } = await historyOpen(user, target)
    const card = await within(panel).findByLabelText('History version 3')
    await user.click(within(card).getByRole('button', { name: 'View details for version 3' }))
    await screen.findByText('Loading details…')
    await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
    await user.click(within(panel).getByRole('button', { name: 'Activate version 3' }))
    const dialog = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog))
    const details = screen.getByRole('region', { name: 'Record details' })
    await waitFor(() => expect(within(details).getByText('Status', { selector: 'dt' }).parentElement?.textContent).toBe('StatusActive'))
    await within(panel).findByText('Current active Recipe: v3')
    await act(async () => pending.resolve(refJson({ data: target })))
    expect(within(details).getByText('Status', { selector: 'dt' }).parentElement?.textContent).toBe('StatusActive')
    expect(within(details).queryByText('Inactive', { selector: '.status' })).toBeNull()
    expect(within(panel).getByLabelText('History version 3').textContent).toContain('Current active version')
    expect(actionPosts()).toHaveLength(1)
  })

  it('ignores a canceled preflight result when another Recipe confirmation is newer', async () => {
    const target = lifecycleVersion(3), newer = lifecycleVersion(4), pending = refDeferred<Response>()
    let defer = true
    const { user, actionPosts } = recipeActionSetup([target, newer], (url, init) => defer && init.method === 'GET'
      && url.pathname === `/api/recipes/${target._id}` ? pending.promise : undefined)
    const { panel, dialog } = await recipeActionOpen(user, target)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Recipe action' }))
    defer = false
    await user.click(within(panel).getByRole('button', { name: 'Activate version 4' }))
    const current = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
    await waitFor(() => expect(recipeActionConfirm(current)).toHaveProperty('disabled', false))
    await act(async () => pending.resolve(refJson({ data: target })))
    expect(current.textContent).toContain(newer._id)
    expect(current.textContent).not.toContain(target._id)
    expect(recipeActionConfirm(current)).toHaveProperty('disabled', false)
    expect(actionPosts()).toHaveLength(0)
  })

  it('supports keyboard confirmation review, cancellation and accessible state announcements', async () => {
    const target = lifecycleVersion(3)
    const { user, actionPosts } = recipeActionSetup([target])
    const { opener, dialog } = await recipeActionOpen(user, target)
    await waitFor(() => expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', false))
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Review Recipe activation' }))
    expect(within(dialog).getByRole('status')).toBeTruthy()
    within(dialog).getByRole('button', { name: 'Cancel Recipe action' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog', { name: 'Recipe lifecycle confirmation' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(actionPosts()).toHaveLength(0)
  })

  it('never mutates when browsing, revealing lifecycle controls, or refreshing history reads', async () => {
    const target = lifecycleVersion(3)
    const { user, fetch } = recipeActionSetup([target, lifecycleVersion(1, { isActive: true })])
    const { panel } = await historyOpen(user, target)
    await within(panel).findByLabelText('History version 3')
    expect(within(panel).queryByRole('button', { name: 'Activate version 3' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
    expect(within(panel).getByRole('button', { name: 'Activate version 3' })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Refresh history and active version' }))
    await within(panel).findByLabelText('History version 3')
    await user.click(within(panel).getByRole('button', { name: 'Hide Recipe lifecycle controls' }))
    expect(screen.queryByRole('dialog', { name: 'Recipe lifecycle confirmation' })).toBeNull()
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it.each(['multiple-active', 'missing-history-target', 'duplicate-history-version', 'active-count-mismatch'])(
    'blocks action preflight when fresh responses contain %s', async inconsistency => {
      const target = lifecycleVersion(3)
      let checking = false
      const { user, actionPosts } = recipeActionSetup([target], (url, init) => {
        if (!checking || init.method !== 'GET') return
        if (isActiveHistoryRead(url)) {
          if (inconsistency === 'multiple-active') return refPage([lifecycleVersion(1, { isActive: true }), lifecycleVersion(2, { isActive: true })])
          if (inconsistency === 'active-count-mismatch') return refPage([], 1, 1, 20)
        }
        if (url.pathname === '/api/recipes' && url.searchParams.get('limit') === '100') {
          if (inconsistency === 'missing-history-target') return refPage([], 1, 0, 100)
          if (inconsistency === 'duplicate-history-version') return refPage([target, { ...target, _id: refRecipe._id }], 1, 2, 100)
        }
      })
      const { panel } = await historyOpen(user, target)
      await within(panel).findByLabelText('History version 3')
      await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
      checking = true
      await user.click(within(panel).getByRole('button', { name: 'Activate version 3' }))
      const dialog = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
      await within(dialog).findByText(/No mutation request was sent/)
      expect(recipeActionConfirm(dialog)).toHaveProperty('disabled', true)
      expect(actionPosts()).toHaveLength(0)
    })

  it('preserves active-directory filters, clamps a shrinking page and refreshes selected details after deactivation', async () => {
    const target = lifecycleVersion(21, { isActive: true })
    const others = Array.from({ length: 20 }, (_, index) => lifecycleVersion(index + 1, {
      isActive: true, productId: `11111111-1111-1111-1111-${String(index + 1).padStart(12, '0')}`,
    }))
    const { user, actionPosts, gets } = recipeActionSetup([target, ...others])
    const { panel } = await historyOpen(user, target)
    await within(panel).findByLabelText('History version 21')
    const directory = screen.getByRole('region', { name: 'Recipes directory' })
    fireEvent.change(within(directory).getByLabelText('Status'), { target: { value: 'true' } })
    fireEvent.change(within(directory).getByLabelText('Rows per page'), { target: { value: '10' } })
    await user.click(within(directory).getByRole('button', { name: 'Apply filters' }))
    await within(directory).findByText('Page 1 of 3')
    await user.click(within(directory).getByRole('button', { name: 'Next' }))
    await within(directory).findByText('Page 2 of 3')
    await user.click(within(directory).getByRole('button', { name: 'Next' }))
    await within(directory).findByText('Page 3 of 3')
    await user.click(within(panel).getByRole('button', { name: 'View details for version 21' }))
    await within(screen.getByRole('region', { name: 'Record details' })).findByText(target._id)
    await user.click(within(panel).getByRole('button', { name: 'Show Recipe lifecycle controls' }))
    await user.click(within(panel).getByRole('button', { name: 'Deactivate version 21' }))
    const dialog = await screen.findByRole('dialog', { name: 'Recipe lifecycle confirmation' })
    await waitFor(() => expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', false))
    const before = gets().length
    await user.click(recipeActionConfirm(dialog, 'deactivate'))
    await within(directory).findByText('Page 2 of 2')
    expect(within(directory).getByLabelText('Status')).toHaveProperty('value', 'true')
    expect(within(directory).getByLabelText('Rows per page')).toHaveProperty('value', '10')
    expect(within(panel).getByLabelText('History Product')).toHaveProperty('value', refProductId)
    expect(within(panel).getByLabelText('History size')).toHaveProperty('value', 'S')
    const details = screen.getByRole('region', { name: 'Record details' })
    await waitFor(() => expect(within(details).getByText('Status', { selector: 'dt' }).parentElement?.textContent).toBe('StatusInactive'))
    expect(within(details).getByText(target._id)).toBeTruthy()
    expect(gets().slice(before).some(url => url.pathname === '/api/recipes' && url.searchParams.get('page') === '2'
      && url.searchParams.get('isActive') === 'true' && url.searchParams.get('limit') === '10')).toBe(true)
    expect(actionPosts()).toHaveLength(1)
  })

  it('reconciles empty-membership deactivation safely when the existing mutation parser cannot confirm its response', async () => {
    const target = lifecycleVersion(3, { isActive: true, ingredients: [] })
    const { user, server, actionPosts, fetch } = recipeActionSetup([target])
    const { dialog } = await recipeActionOpen(user, target, 'deactivate')
    await waitFor(() => expect(recipeActionConfirm(dialog, 'deactivate')).toHaveProperty('disabled', false))
    await user.click(recipeActionConfirm(dialog, 'deactivate'))
    await within(dialog).findByText(/lifecycle outcome is unknown/i)
    expect(server.rows[0].isActive).toBe(false)
    expect(actionPosts()).toHaveLength(1)
    const before = fetch.mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Refresh server state' }))
    await within(dialog).findByText(/Server state was observed after refresh/)
    expect(dialog.textContent).toContain('No active Recipe')
    expect(fetch.mock.calls.slice(before).every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(actionPosts()).toHaveLength(1)
  })

  it('never sends a lifecycle POST after the Catalog unmounts during preflight', async () => {
    const target = lifecycleVersion(3), pending = refDeferred<Response>()
    const { user, unmount, actionPosts } = recipeActionSetup([target], (url, init) => init.method === 'GET'
      && url.pathname === `/api/recipes/${target._id}` ? pending.promise : undefined)
    await recipeActionOpen(user, target)
    unmount()
    await act(async () => pending.resolve(refJson({ data: target })))
    expect(actionPosts()).toHaveLength(0)
  })
})
