import { useState } from 'react'
import { CatalogApiError, createCatalogClient } from './api/catalog'
import Catalog from './catalog/Catalog'
import './App.css'

function connect() {
  try { return { client: createCatalogClient(), error: '' } }
  catch (error) { return { client: undefined, error: error instanceof CatalogApiError ? error.message : 'Catalog configuration is unavailable.' } }
}

export default function App() {
  const [connection, setConnection] = useState(connect)
  if (!connection.client) return <main className="connection-state">
    <span className="brand-mark" aria-hidden="true">W</span>
    <p className="eyebrow">WaveHouse / Catalog</p><h1>Connect your catalog</h1>
    <p role="alert">{connection.error}</p>
    <p>Configure the Web environment and restart the development server to load the catalog.</p>
    <button type="button" onClick={() => setConnection(connect())}>Retry connection</button>
  </main>
  return <Catalog client={connection.client} />
}
