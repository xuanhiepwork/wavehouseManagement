export type CatalogErrorCode =
  | 'CONFIGURATION' | 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'SERVER_ERROR'
  | 'HTTP_ERROR' | 'NETWORK' | 'MALFORMED_RESPONSE' | 'TIMEOUT' | 'CANCELLED';

const messages: Readonly<Record<CatalogErrorCode, string>> = {
  CONFIGURATION: 'Configure EXPO_PUBLIC_API_BASE_URL with an explicit loopback HTTP(S) API URL.',
  BAD_REQUEST: 'The catalog read request is invalid.',
  NOT_FOUND: 'The requested catalog record was not found.',
  CONFLICT: 'The catalog request conflicts with the current data.',
  SERVER_ERROR: 'The catalog service encountered an error.',
  HTTP_ERROR: 'The catalog request failed.',
  NETWORK: 'The catalog service could not be reached.',
  MALFORMED_RESPONSE: 'The catalog service returned an invalid response.',
  TIMEOUT: 'The catalog read timed out. Please retry when ready.',
  CANCELLED: 'The catalog read was cancelled.',
};

/** Never retain server bodies, URLs, credentials, or an original exception/cause. */
export class CatalogApiError extends Error {
  readonly code: CatalogErrorCode;
  readonly status?: number;

  constructor(code: CatalogErrorCode, status?: number) {
    super(messages[code]);
    this.name = 'CatalogApiError';
    this.code = code;
    this.status = status;
  }
}

export function httpError(status: number): CatalogApiError {
  const code = status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND'
    : status === 409 ? 'CONFLICT' : status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR';
  return new CatalogApiError(code, status);
}
