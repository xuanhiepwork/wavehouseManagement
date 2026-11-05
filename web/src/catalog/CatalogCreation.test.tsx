// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatalogClient } from '../api/catalog'
import type { Ingredient, Product } from '../api/catalog'
import Catalog from './Catalog'

const ingredientId = '11111111-1111-1111-1111-111111111111'
const productId = '22222222-2222-2222-2222-222222222222'
const metadata = { createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' }
const ingredient: Ingredient = { ...metadata, _id: ingredientId, code: 'MILK', name: 'Oat milk', category: 'Dairy', unit: 'ml', costPrice: '1.23', minStock: '0', isActive: true }
const product: Product = { ...metadata, _id: productId, code: 'TEA', name: 'House tea', category: 'Drinks', prices: [{ size: 'S', price: '1.23' }], isAvailable: true }
type Kind = 'ingredient' | 'product'
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
function page(data: unknown[] = [], pageNumber = 1, total = data.length, limit = 20) {
  return json({ data, pagination: { page: pageNumber, limit, total, totalPages: Math.ceil(total / limit) } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(handler?: Handler, timeoutMs = 1_000) {
  // An accidental fallback to the real global fetch fails before any network access.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked network request is forbidden') }))
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, initial) => {
    const init = initial ?? {}
    const url = new URL(String(input))
    if (url.origin !== 'http://127.0.0.1:5000') throw new Error('Unexpected origin')
    const override = handler?.(url, init)
    if (override !== undefined) return override
    if (init.method === 'GET') {
      if (/^\/api\/(ingredients|products|recipes)$/.test(url.pathname)) return page()
      if (url.pathname === `/api/ingredients/${ingredientId}`) return json({ data: ingredient })
      if (url.pathname === `/api/products/${productId}`) return json({ data: product })
    }
    if (init.method === 'POST' && url.pathname === '/api/ingredients') return json({ data: ingredient }, 201)
    if (init.method === 'POST' && url.pathname === '/api/products') return json({ data: product }, 201)
    throw new Error('Unexpected mocked Catalog request')
  })
  const client = createCatalogClient({ baseUrl: 'http://127.0.0.1:5000/api', fetch, timeoutMs })
  render(<Catalog client={client} />)
  return { user: userEvent.setup(), fetch, posts: () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST'), gets: () => fetch.mock.calls.filter(([, init]) => init?.method === 'GET').map(([url]) => new URL(String(url))) }
}
async function open(user: ReturnType<typeof userEvent.setup>, kind: Kind = 'ingredient') {
  if (kind === 'product') await user.click(screen.getByRole('button', { name: 'Products' }))
  await user.click(screen.getByRole('button', { name: `New ${kind}` }))
  return screen.getByRole('form', { name: `Create ${kind}` })
}
function set(form: HTMLElement, label: string, value: string) {
  fireEvent.change(within(form).getByLabelText(label, { exact: true }), { target: { value } })
}
function fill(form: HTMLElement, kind: Kind = 'ingredient') {
  set(form, 'Code', kind === 'ingredient' ? 'MILK' : 'TEA')
  set(form, 'Name', kind === 'ingredient' ? 'Oat milk' : 'House tea')
  set(form, 'Category', kind === 'ingredient' ? 'Dairy' : 'Drinks')
  if (kind === 'ingredient') { set(form, 'Unit', 'ml'); set(form, 'Cost price', '1.2300') }
  else set(form, 'Price 1', '1.2300')
}
async function submit(user: ReturnType<typeof userEvent.setup>, form: HTMLElement, kind: Kind = 'ingredient') {
  await user.click(within(form).getByRole('button', { name: `Create ${kind}` }))
}
function expectInvalid(form: HTMLElement, label: string) {
  const input = within(form).getByLabelText(label, { exact: true })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  const descriptions = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  expect(descriptions.length).toBeGreaterThan(0)
  expect(descriptions.some(id => document.getElementById(id)?.textContent)).toBe(true)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('creation payloads and successful lifecycle', () => {
  it('offers Catalog creation without activation, editing or deletion controls', async () => {
    const { user, posts } = setup()
    expect(await screen.findByRole('button', { name: 'New ingredient' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Products' }))
    expect(screen.getByRole('button', { name: 'New product' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Recipes' }))
    expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /activate|deactivate|edit|delete/i })).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('submits Ingredient maximum precision as exact decimal strings and refreshes after success', async () => {
    let created = false
    const { user, posts, gets } = setup((url, init) => {
      if (init.method === 'POST') { created = true; return json({ data: ingredient }, 201) }
      if (url.pathname === '/api/ingredients') return page(created ? [ingredient] : [])
      return undefined
    })
    const form = await open(user)
    fill(form)
    set(form, 'Code', ' milk '); set(form, 'Name', ' Oat milk '); set(form, 'Category', ' Dairy ')
    set(form, 'Cost price', '99999999999999.9999'); set(form, 'Minimum stock', '999999999999.999999')
    await user.click(within(form).getByRole('checkbox', { name: 'Active' }))
    await submit(user, form)
    await screen.findByText(/MILK created successfully/i)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ code: 'MILK', name: 'Oat milk', category: 'Dairy', unit: 'ml', costPrice: '99999999999999.9999', minStock: '999999999999.999999', isActive: false })
    expect(await screen.findByRole('table', { name: 'Ingredients catalog' })).toBeTruthy()
    expect(gets().filter(url => url.pathname === '/api/ingredients').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('form', { name: 'Create ingredient' })).toBeNull()
    const clean = await open(user)
    expect(within(clean).getByLabelText('Code', { exact: true })).toHaveProperty('value', '')
    expect(posts()).toHaveLength(1)
  })

  it('preserves leading and fractional zeros in Ingredient requests and omits blank optional stock', async () => {
    const { user, posts } = setup()
    const form = await open(user)
    fill(form); set(form, 'Cost price', '0001.2300')
    await submit(user, form)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ code: 'MILK', name: 'Oat milk', category: 'Dairy', unit: 'ml', costPrice: '0001.2300', isActive: true })
  })

  it('submits distinct Product prices in S/M/L order with exact strings and trimmed optional text', async () => {
    const { user, posts } = setup()
    const form = await open(user, 'product')
    fill(form, 'product'); set(form, 'Size 1', 'L'); set(form, 'Price 1', '99999999999999.9999')
    await user.click(within(form).getByRole('button', { name: 'Add size price' }))
    set(form, 'Size 2', 'S'); set(form, 'Price 2', '0001.2300')
    await user.click(within(form).getByRole('button', { name: 'Add size price' }))
    set(form, 'Size 3', 'M'); set(form, 'Price 3', '0.0001')
    set(form, 'Description', ' Freshly brewed.\n Served cold. ')
    set(form, 'Image URL', ' images/tea.png ')
    await user.click(within(form).getByRole('checkbox', { name: 'Available' }))
    await submit(user, form, 'product')
    await screen.findByText(/TEA created successfully/i)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ code: 'TEA', name: 'House tea', category: 'Drinks', description: 'Freshly brewed.\n Served cold.', imageUrl: 'images/tea.png', isAvailable: false, prices: [{ size: 'S', price: '0001.2300' }, { size: 'M', price: '0.0001' }, { size: 'L', price: '99999999999999.9999' }] })
  })

  it('omits blank optional Product text and refreshes its own list after creation', async () => {
    let created = false
    const { user, posts, gets } = setup((url, init) => {
      if (url.pathname === '/api/products' && init.method === 'POST') { created = true; return json({ data: product }, 201) }
      if (url.pathname === '/api/products') return page(created ? [product] : [])
      return undefined
    })
    const form = await open(user, 'product'); fill(form, 'product')
    set(form, 'Description', '   '); set(form, 'Image URL', '   ')
    await submit(user, form, 'product')
    expect(await screen.findByRole('table', { name: 'Products catalog' })).toBeTruthy()
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ code: 'TEA', name: 'House tea', category: 'Drinks', isAvailable: true, prices: [{ size: 'S', price: '1.2300' }] })
    expect(gets().filter(url => url.pathname === '/api/products')).toHaveLength(2)
  })

  it('resets pagination and selection after success while retaining applied filters and page size', async () => {
    const { user, posts, gets } = setup((url, init) => init.method === 'GET' && url.pathname === '/api/ingredients' ? page([ingredient], Number(url.searchParams.get('page') ?? 1), 45, Number(url.searchParams.get('limit') ?? 20)) : undefined)
    await screen.findByRole('table')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '10')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'milk' } })
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 5')
    await user.click(screen.getByRole('button', { name: 'View Oat milk' }))
    await screen.findByRole('heading', { name: 'Oat milk' })
    const form = await open(user); fill(form)
    await submit(user, form)
    await screen.findByText('Page 1 of 5')
    expect(screen.queryByRole('region', { name: 'Record details' })).toBeNull()
    const latest = gets().filter(url => url.pathname === '/api/ingredients').at(-1)!
    expect(latest.searchParams.get('page')).toBe('1')
    expect(latest.searchParams.get('limit')).toBe('10')
    expect(latest.searchParams.get('search')).toBe('milk')
    expect(posts()).toHaveLength(1)
  })
})

describe('backend-aligned field validation', () => {
  it.each<Kind>(['ingredient', 'product'])('shows linked required-field errors for %s without sending a POST', async kind => {
    const { user, posts } = setup()
    const form = await open(user, kind)
    await submit(user, form, kind)
    for (const label of ['Code', 'Name', 'Category', ...(kind === 'ingredient' ? ['Unit', 'Cost price'] : ['Price 1'])]) expectInvalid(form, label)
    expect(posts()).toHaveLength(0)
  })

  it.each(['.5', '1.', '-1', '+1', '1e3', ' 1 ', 'NaN', '0.00001', '1.23000', '100000000000000', '0'.repeat(101)])('rejects invalid Ingredient cost %j without altering its text', async value => {
    const { user, posts } = setup()
    const form = await open(user); fill(form); set(form, 'Cost price', value)
    await submit(user, form)
    expectInvalid(form, 'Cost price')
    expect(within(form).getByLabelText('Cost price', { exact: true })).toHaveProperty('value', value)
    expect(posts()).toHaveLength(0)
  })

  it.each(['0.0000001', '1.0000000', '1000000000000'])('rejects out-of-range Ingredient stock %s', async value => {
    const { user, posts } = setup()
    const form = await open(user); fill(form); set(form, 'Minimum stock', value)
    await submit(user, form)
    expectInvalid(form, 'Minimum stock'); expect(posts()).toHaveLength(0)
  })

  it.each(['0.00001', '-0', '100000000000000'])('validates Product prices %s at four decimal places', async value => {
    const { user, posts } = setup()
    const form = await open(user, 'product'); fill(form, 'product'); set(form, 'Price 1', value)
    await submit(user, form, 'product')
    expectInvalid(form, 'Price 1'); expect(posts()).toHaveLength(0)
  })

  it('validates the uppercased code length, including Unicode uppercase expansion', async () => {
    const { user, posts } = setup()
    const form = await open(user); fill(form); set(form, 'Code', 'ß'.repeat(33))
    await submit(user, form)
    expectInvalid(form, 'Code'); expect(posts()).toHaveLength(0)
  })

  it('counts name limits in Unicode code points and accepts an exact 200-character name', async () => {
    const { user, posts } = setup()
    const form = await open(user); fill(form); set(form, 'Name', '🌊'.repeat(200))
    await submit(user, form)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0][1]?.body)).name).toBe('🌊'.repeat(200))
  })

  it.each([['Name', 'a'.repeat(201)], ['Category', 'a'.repeat(101)], ['Code', 'a\0b']])('rejects unsupported %s text', async (label, value) => {
    const { user, posts } = setup()
    const form = await open(user); fill(form); set(form, label, value)
    await submit(user, form)
    expectInvalid(form, label); expect(posts()).toHaveLength(0)
  })

  it('prevents duplicate Product sizes in controls and validation and enforces at most three rows', async () => {
    const { user, posts } = setup()
    const form = await open(user, 'product'); fill(form, 'product')
    await user.click(within(form).getByRole('button', { name: 'Add size price' }))
    expect(within(within(form).getByLabelText('Size 2', { exact: true })).getByRole('option', { name: 'S' })).toHaveProperty('disabled', true)
    set(form, 'Size 2', 'S'); set(form, 'Price 2', '2')
    await submit(user, form, 'product')
    expectInvalid(form, 'Size 2'); expect(posts()).toHaveLength(0)
    set(form, 'Size 2', 'M')
    await user.click(within(form).getByRole('button', { name: 'Add size price' }))
    expect(within(form).getByRole('button', { name: 'Add size price' })).toHaveProperty('disabled', true)
    set(form, 'Price 3', '3')
    await user.click(within(form).getByRole('button', { name: 'Remove price 2' }))
    expect(within(form).queryByLabelText('Price 3', { exact: true })).toBeNull()
    expect(within(form).getByLabelText('Price 2', { exact: true })).toHaveProperty('value', '3')
  })
})

describe('draft preservation and duplicate-submission protection', () => {
  it.each<Kind>(['ingredient', 'product'])('keeps the %s draft when the form is closed or sections change', async kind => {
    const { user, posts } = setup()
    const form = await open(user, kind); fill(form, kind); set(form, 'Name', 'Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Close creation form' }))
    const reopened = await open(user, kind)
    expect(within(reopened).getByLabelText('Name', { exact: true })).toHaveProperty('value', 'Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Recipes' }))
    await user.click(screen.getByRole('button', { name: kind === 'ingredient' ? 'Ingredients' : 'Products' }))
    const returned = screen.queryByRole('form', { name: `Create ${kind}` }) ?? await open(user, kind)
    expect(within(returned).getByLabelText('Name', { exact: true })).toHaveProperty('value', 'Unsaved draft')
    expect(posts()).toHaveLength(0)
  })

  it.each<Kind>(['ingredient', 'product'])('sends only one pending %s POST even for synchronous submit events', async kind => {
    const pending = deferred<Response>()
    const { user, posts } = setup((_url, init) => init.method === 'POST' ? pending.promise : undefined)
    const form = await open(user, kind); fill(form, kind)
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(within(form).getByRole('button', { name: /creating/i }).matches(':disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Recipes' })).toHaveProperty('disabled', true)
    expect(within(form).getByLabelText('Code', { exact: true }).matches(':disabled')).toBe(true)
    await act(async () => pending.resolve(json({ data: kind === 'ingredient' ? ingredient : product }, 201)))
    expect(posts()).toHaveLength(1)
  })

  it.each<[Kind, number]>([['ingredient', 400], ['ingredient', 409], ['product', 400], ['product', 409]])('preserves %s input on HTTP %s without automatic retries or leaking details', async (kind, status) => {
    const { user, posts } = setup((_url, init) => init.method === 'POST' ? json({ error: 'database password SECRET' }, status) : undefined)
    const form = await open(user, kind); fill(form, kind)
    await submit(user, form, kind)
    await within(form).findByRole('alert')
    expect(document.body.textContent).not.toContain('SECRET')
    expect(within(form).getByLabelText('Code', { exact: true })).toHaveProperty('value', kind === 'ingredient' ? 'MILK' : 'TEA')
    expect(within(form).getByLabelText(kind === 'ingredient' ? 'Cost price' : 'Price 1', { exact: true })).toHaveProperty('value', '1.2300')
    expect(within(form).getByRole('button', { name: `Create ${kind}` })).toHaveProperty('disabled', false)
    expect(posts()).toHaveLength(1)
  })
})

describe('uncertain mutation outcomes and deliberate recovery', () => {
  it.each(['network', 'timeout', 'server', 'malformed'] as const)('keeps an Ingredient draft blocked after %s until a successful refresh and deliberate acknowledgement', async failure => {
    const pending = deferred<Response>()
    const { user, posts, gets } = setup((_url, init) => {
      if (init.method !== 'POST') return undefined
      if (failure === 'network') return Promise.reject(new Error('offline secret'))
      if (failure === 'timeout') return pending.promise
      if (failure === 'server') return json({ error: 'database SECRET' }, 500)
      return json({ data: { ...ingredient, costPrice: 1.23 } }, 201)
    }, failure === 'timeout' ? 35 : 1_000)
    const form = await open(user); fill(form)
    await submit(user, form)
    await within(form).findByRole('alert')
    expect(within(form).getByRole('button', { name: 'Create ingredient' })).toHaveProperty('disabled', true)
    expect(within(form).getByLabelText('Cost price', { exact: true })).toHaveProperty('value', '1.2300')
    expect(document.body.textContent).not.toContain('SECRET')
    expect(document.body.textContent).toMatch(/may have been saved|outcome is unknown/i)
    await user.click(within(form).getByRole('button', { name: 'Refresh server state' }))
    const acknowledge = await within(form).findByRole('checkbox', { name: 'I reviewed the refreshed catalog and want to submit again.' })
    const checks = gets().filter(url => url.pathname === '/api/ingredients' && url.searchParams.get('search') === 'MILK')
    expect(new Set(checks.map(url => url.searchParams.get('isActive')))).toEqual(new Set(['true', 'false']))
    expect(posts()).toHaveLength(1)
    expect(within(form).getByRole('button', { name: 'Submit again' })).toHaveProperty('disabled', true)
    await user.click(acknowledge)
    expect(within(form).getByRole('button', { name: 'Submit again' })).toHaveProperty('disabled', false)
    expect(posts()).toHaveLength(1)
  })

  it('recovers a Product network failure using an all-availability code lookup before explicit resubmission', async () => {
    let fail = true
    const { user, posts, gets } = setup((_url, init) => init.method === 'POST' && fail ? Promise.reject(new Error('offline')) : undefined)
    const form = await open(user, 'product'); fill(form, 'product')
    await submit(user, form, 'product'); await within(form).findByRole('alert')
    expect(within(form).getByRole('button', { name: 'Create product' })).toHaveProperty('disabled', true)
    fail = false
    await user.click(within(form).getByRole('button', { name: 'Refresh server state' }))
    await user.click(await within(form).findByRole('checkbox', { name: 'I reviewed the refreshed catalog and want to submit again.' }))
    const lookup = gets().find(url => url.pathname === '/api/products' && url.searchParams.get('search') === 'TEA')!
    expect(lookup.searchParams.has('isAvailable')).toBe(false)
    expect(posts()).toHaveLength(1)
    await user.click(within(form).getByRole('button', { name: 'Submit again' }))
    await screen.findByText(/TEA created successfully/i)
    expect(posts()).toHaveLength(2)
  })

  it('keeps submission blocked when refreshing server state fails', async () => {
    const { user, posts } = setup((url, init) => init.method === 'POST' ? Promise.reject(new Error('offline')) : url.searchParams.get('search') === 'MILK' ? json({ error: 'unavailable' }, 500) : undefined)
    const form = await open(user); fill(form)
    await submit(user, form); await within(form).findByRole('alert')
    await user.click(within(form).getByRole('button', { name: 'Refresh server state' }))
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Refresh server state' })).toHaveProperty('disabled', false))
    expect(within(form).queryByRole('checkbox', { name: /reviewed the refreshed catalog/ })).toBeNull()
    expect(within(form).getByRole('button', { name: 'Create ingredient' })).toHaveProperty('disabled', true)
    expect(posts()).toHaveLength(1)
  })

  it('checks all search result pages and inactive Ingredients before allowing a same-code retry', async () => {
    const { user, posts, gets } = setup((url, init) => {
      if (init.method === 'POST') return Promise.reject(new Error('unknown result'))
      if (url.pathname === '/api/ingredients' && url.searchParams.get('search') === 'MILK') {
        if (url.searchParams.get('isActive') !== 'false') return page()
        const p = Number(url.searchParams.get('page') ?? 1)
        const limit = Number(url.searchParams.get('limit') ?? 20)
        return page(p === 1 ? Array.from({ length: limit }, (_, index) => ({ ...ingredient, _id: `${String(index + 3).padStart(8, '0')}-3333-3333-3333-333333333333`, code: `MILK-${index}` })) : [{ ...ingredient, isActive: false }], p, limit + 1, limit)
      }
      return undefined
    })
    const form = await open(user); fill(form)
    await submit(user, form); await within(form).findByRole('alert')
    await user.click(within(form).getByRole('button', { name: 'Refresh server state' }))
    expect(await within(form).findByRole('button', { name: 'View existing record' })).toBeTruthy()
    expect(gets().some(url => url.searchParams.get('search') === 'MILK' && url.searchParams.get('page') === '2')).toBe(true)
    expect(posts()).toHaveLength(1)
    expect(within(form).getByLabelText('Code', { exact: true })).toHaveProperty('value', 'MILK')
    expect(within(form).getByRole('button', { name: /create ingredient|submit again/i })).toHaveProperty('disabled', true)
    await user.click(within(form).getByRole('button', { name: 'View existing record' }))
    expect(await screen.findByRole('heading', { name: 'Oat milk' })).toBeTruthy()
    expect(posts()).toHaveLength(1)
  })
})
