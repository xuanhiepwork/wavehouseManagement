import { CatalogApiError } from '../api/catalog.errors.ts';

/** Pure normalization is separate from Expo's statically inlined environment access. */
export function normalizeCatalogBaseUrl(value: unknown): string {
  try {
    if (typeof value !== 'string' || value !== value.trim() || !/^https?:\/\//i.test(value)) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash
      || !['/', '/api', '/api/'].includes(url.pathname)) throw new Error();
    return `${url.origin}/api`;
  } catch {
    throw new CatalogApiError('CONFIGURATION');
  }
}

/** No default host, network request, or environment access runs merely by importing this module. */
export function getCatalogBaseUrl(explicit?: string): string {
  return normalizeCatalogBaseUrl(explicit ?? process.env.EXPO_PUBLIC_API_BASE_URL);
}
