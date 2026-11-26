import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogApiError, createCatalogClient } from './api/catalog'
import Catalog from './catalog/Catalog'
import type { AuthSession } from './workspace/auth'
import './App.css'

function connect(session?: AuthSession, getToken?: () => string | undefined) {
  try { return { client: createCatalogClient(session ? { sameOrigin: true, getToken } : {}), error: '' } }
  catch (error) { return { client: undefined, error: error instanceof CatalogApiError ? error.message : 'Catalog configuration is unavailable.' } }
}

export default function App({ session, onDirtyChange, onWorkingChange }: { session?: AuthSession; onDirtyChange?: (value: boolean) => void; onWorkingChange?: (value: boolean) => void }) {
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])
  const getToken = useCallback(() => sessionRef.current?.token, [])
  const [connection, setConnection] = useState(() => connect(session, () => session?.token))
  if (!connection.client) return <main className="connection-state">
    <span className="brand-mark" aria-hidden="true">W</span>
    <p className="eyebrow">WaveHouse / Catalog</p><h1>Connect your catalog</h1>
    <p role="alert">{connection.error}</p>
    <p>Configure the Web environment and restart the development server to load the catalog.</p>
    <button type="button" onClick={() => setConnection(connect(session, getToken))}>Retry connection</button>
  </main>
  return <Catalog client={connection.client} onDirtyChange={onDirtyChange} onWorkingChange={onWorkingChange} />
}
