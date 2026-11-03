export type CatalogErrorCode =
  | 'CONFIGURATION' | 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'SERVER_ERROR'
  | 'HTTP_ERROR' | 'NETWORK' | 'MALFORMED_RESPONSE' | 'TIMEOUT'

const messages: Record<CatalogErrorCode, string> = {
  CONFIGURATION: 'Set VITE_API_BASE_URL to an explicit loopback HTTP(S) URL (origin or /api).',
  BAD_REQUEST: 'The catalog request is invalid.',
  NOT_FOUND: 'The requested catalog record was not found.',
  CONFLICT: 'The catalog request conflicts with the current data.',
  SERVER_ERROR: 'The catalog service encountered an error.',
  HTTP_ERROR: 'The catalog request failed.',
  NETWORK: 'The catalog service could not be reached.',
  MALFORMED_RESPONSE: 'The catalog service returned an invalid response.',
  TIMEOUT: 'The catalog request timed out. Its outcome may be unknown.',
}

/** Contains no server body, request payload, URL, or original exception/cause. */
export class CatalogApiError extends Error {
  readonly code: CatalogErrorCode
  readonly status?: number

  constructor(code: CatalogErrorCode, status?: number) {
    super(messages[code])
    this.name = 'CatalogApiError'
    this.code = code
    this.status = status
  }
}

export function httpError(status: number): CatalogApiError {
  const code = status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND'
    : status === 409 ? 'CONFLICT' : status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR'
  return new CatalogApiError(code, status)
}
