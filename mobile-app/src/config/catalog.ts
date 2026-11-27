import { CatalogApiError } from '../api/catalog.errors.ts';

/** HTTPS for hosted backends; HTTP exclusively for developer loopback (ADB reverse / emulator).
 * Never ship login credentials over a publicly reachable HTTP address.
 */
export function normalizeCatalogBaseUrl(value: unknown): string {
  try {
    if (typeof value !== 'string' || value !== value.trim() || !/^https?:\/\//i.test(value)) throw new Error();
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !local)
      || url.username || url.password || url.search || url.hash
      || !['/', '/api', '/api/'].includes(url.pathname)) throw new Error();
    return `${url.origin}/api`;
  } catch { throw new CatalogApiError('CONFIGURATION'); }
}

/** No implicit host; Expo statically embeds this public, NON-SECRET config value. */
export function getCatalogBaseUrl(explicit?: string): string {
  return normalizeCatalogBaseUrl(explicit ?? process.env.EXPO_PUBLIC_API_BASE_URL);
}
