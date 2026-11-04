import { useRef, useState } from 'react'
import { CatalogApiError } from '../api/catalog'
import type { CatalogClient, Ingredient, PageEnvelope, Product } from '../api/catalog'
import { emptyCreationDraft, validateCreation } from './creation.validation'
import type { CreationDraft, CreationKind, FieldErrors } from './creation.validation'

export type CreationClient = {
  ingredients: Pick<CatalogClient['ingredients'], 'create' | 'list'>
  products: Pick<CatalogClient['products'], 'create' | 'list'>
}
type Phase = 'editing' | 'saving' | 'uncertain' | 'checking' | 'reviewed'
type CreatedRecord = Ingredient | Product

/** Drafts and outcome guards live above section navigation; only an explicit submit sends POST. */
export function useCatalogCreation(kind: CreationKind, client: CreationClient) {
  const [draft, setDraft] = useState(emptyCreationDraft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('editing')
  const [message, setMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [existing, setExisting] = useState<CreatedRecord>()
  const gate = useRef<Phase>('editing')
  const attemptedCode = useRef('')
  const setGate = (value: Phase) => { gate.current = value; setPhase(value) }
  const busy = phase === 'saving' || phase === 'checking'
  const sameExistingCode = existing !== undefined && draft.code.trim().toUpperCase() === existing.code
  const canSubmit = !busy && phase !== 'uncertain' && (phase !== 'reviewed' || (acknowledged && !sameExistingCode))

  function change<K extends keyof CreationDraft>(key: K, value: CreationDraft[K]) {
    if (gate.current === 'saving' || gate.current === 'checking') return
    setDraft(previous => ({ ...previous, [key]: value }))
    // A deliberate resubmission acknowledgement applies to the currently reviewed draft.
    setAcknowledged(false)
  }
  function close() {
    if (gate.current !== 'saving' && gate.current !== 'checking') setVisible(false)
  }
  async function submit(onCreated: (record: CreatedRecord) => void) {
    if (gate.current === 'saving' || gate.current === 'checking' || gate.current === 'uncertain') return
    if (gate.current === 'reviewed' && (!acknowledged || sameExistingCode)) return
    const validated = validateCreation(kind, draft)
    setErrors(validated.errors)
    if (!validated.payload) return
    const payload = validated.payload
    attemptedCode.current = payload.input.code
    setGate('saving') // Synchronous ref also guards duplicate submits before React renders.
    setMessage('')
    let record: CreatedRecord
    try {
      record = payload.kind === 'ingredients' ? (await client.ingredients.create(payload.input)).data
        : (await client.products.create(payload.input)).data
    } catch (error) {
      const definiteRejection = error instanceof CatalogApiError && ['BAD_REQUEST', 'CONFLICT', 'NOT_FOUND', 'CONFIGURATION'].includes(error.code)
      setMessage(error instanceof CatalogApiError ? error.message : 'The creation request could not be confirmed.')
      setGate(definiteRejection ? 'editing' : 'uncertain')
      setAcknowledged(false)
      setExisting(undefined)
      return
    }
    // Reset only after the client confirms a valid success response. Reads fail independently.
    setDraft(emptyCreationDraft())
    setErrors({})
    setExisting(undefined)
    setAcknowledged(false)
    setVisible(false)
    setGate('editing')
    onCreated(record)
  }

  async function refreshServerState(onRefreshed: () => void) {
    if (gate.current !== 'uncertain' && gate.current !== 'reviewed') return
    setGate('checking')
    setMessage('')
    setAcknowledged(false)
    try {
      let match: CreatedRecord | undefined
      // Codes are reserved across states; check both Ingredient states, not the visible filter.
      for (const active of kind === 'ingredients' ? [true, false] : [undefined]) {
        let page = 1
        for (;;) {
          const result: PageEnvelope<CreatedRecord> = kind === 'ingredients'
            ? await client.ingredients.list({ search: attemptedCode.current, isActive: active, page, limit: 100 })
            : await client.products.list({ search: attemptedCode.current, page, limit: 100 })
          match = result.data.find(row => row.code === attemptedCode.current)
          if (match || page >= result.pagination.totalPages) break
          page++
        }
        if (match) break
      }
      setExisting(match)
      setGate('reviewed')
      onRefreshed()
    } catch (error) {
      setMessage(error instanceof CatalogApiError ? error.message : 'Server state could not be checked. Please try refreshing again.')
      setGate('uncertain')
    }
  }
  return { kind, draft, change, errors, visible, open: () => setVisible(true), close, phase, busy,
    canSubmit, message, submit, refreshServerState, existing, attemptedCode: attemptedCode.current,
    acknowledged, acknowledge: setAcknowledged }
}
export type CatalogCreationModel = ReturnType<typeof useCatalogCreation>
