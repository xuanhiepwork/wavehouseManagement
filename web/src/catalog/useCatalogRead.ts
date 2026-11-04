import { useEffect, useMemo, useState } from 'react'
import { CatalogApiError } from '../api/catalog'

function safeMessage(error: unknown) {
  return error instanceof CatalogApiError ? error.message : 'The catalog could not be loaded. Please try again.'
}

/**
 * Pass a stable loader (for example useCallback). Changing it or retrying hides old data immediately.
 * Superseded/unmounted results and failures are ignored; retry is an explicit read, never automatic.
 * This manages read state only: HTTP behavior and timeouts remain with the API client.
 */
export function useCatalogRead<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const key = useMemo(() => ({ load, attempt }), [load, attempt])
  const [result, setResult] = useState<{ key: typeof key; data?: T; error?: string }>()
  useEffect(() => {
    let current = true
    void Promise.resolve().then(load).then(
      data => { if (current) setResult({ key, data }) },
      error => { if (current) setResult({ key, error: safeMessage(error) }) },
    )
    return () => { current = false }
  }, [load, key])
  return { data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key, retry: () => setAttempt(value => value + 1) }
}
