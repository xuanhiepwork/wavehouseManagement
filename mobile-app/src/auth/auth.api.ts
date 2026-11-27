import { getCatalogBaseUrl } from '../config/catalog.ts';
import { beginAuthSession, clearAuthSession, currentAccessToken } from './session.ts';
import type { MobileUser } from './session.ts';

const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const bearer = /^[A-Za-z0-9_-]{43}$/;
export type AuthFailureCode = 'CONFIGURATION' | 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'RATE_LIMITED'
  | 'UNAVAILABLE' | 'NETWORK' | 'INVALID_RESPONSE' | 'TIMEOUT';
const messages: Record<AuthFailureCode,string> = {
  CONFIGURATION: 'Chưa cấu hình địa chỉ máy chủ. Báo quản lý hoặc bộ phận kỹ thuật.',
  INVALID_INPUT: 'Vui lòng nhập email và mật khẩu hợp lệ.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu chưa đúng.',
  RATE_LIMITED: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.',
  UNAVAILABLE: 'Máy chủ đăng nhập đang tạm gián đoạn.',
  NETWORK: 'Không có kết nối đến máy chủ. Hãy kiểm tra mạng.',
  INVALID_RESPONSE: 'Máy chủ trả về dữ liệu không hợp lệ.',
  TIMEOUT: 'Kết nối quá lâu. Vui lòng thử lại khi mạng ổn định.',
};
export class MobileAuthError extends Error {
  readonly code: AuthFailureCode;
  constructor(code: AuthFailureCode) { super(messages[code]); this.name = 'MobileAuthError'; this.code = code; }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isUser(value: unknown): value is MobileUser {
  if (!record(value)) return false;
  return typeof value.id === 'string' && uuid.test(value.id)
    && typeof value.email === 'string' && value.email.length > 0 && value.email.length <= 254
    && typeof value.displayName === 'string' && value.displayName.length > 0
    && ['ADMIN', 'BRANCH_MANAGER', 'STAFF'].includes(String(value.role))
    && (value.branchId === null || (typeof value.branchId === 'string' && uuid.test(value.branchId)))
    && (value.areaId === null || (typeof value.areaId === 'string' && uuid.test(value.areaId)))
    && (value.workKind === null || value.workKind === 'SALES' || value.workKind === 'KITCHEN_DELIVERY');
}
function errorForStatus(status: number): MobileAuthError {
  return new MobileAuthError(status === 401 ? 'INVALID_CREDENTIALS'
    : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'UNAVAILABLE' : 'INVALID_RESPONSE');
}
function baseUrl(explicit?: string): string {
  try { return getCatalogBaseUrl(explicit); } catch { throw new MobileAuthError('CONFIGURATION'); }
}
export interface MobileAuthClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}
export function createMobileAuthClient(options: MobileAuthClientOptions = {}) {
  const base = baseUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new MobileAuthError('CONFIGURATION');
  }
  return Object.freeze({
    async signIn(email: string, password: string): Promise<MobileUser> {
      if (typeof email !== 'string' || typeof password !== 'string'
        || !email.trim() || !email.includes('@') || email.length > 254
        || !password.length || password.length > 1024) throw new MobileAuthError('INVALID_INPUT');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const url = `${base}/auth/login`;
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }), signal: controller.signal,
        });
        if (controller.signal.aborted) throw new MobileAuthError('TIMEOUT');
        if (!response.ok) throw errorForStatus(response.status);
        if (response.redirected || (response.url && response.url !== url)
          || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
          throw new MobileAuthError('INVALID_RESPONSE');
        }
        const result: unknown = await response.json();
        if (controller.signal.aborted) throw new MobileAuthError('TIMEOUT');
        if (!record(result) || typeof result.token !== 'string' || !bearer.test(result.token)
          || result.tokenType !== 'Bearer' || !Number.isSafeInteger(result.expiresIn)
          || (result.expiresIn as number) <= 0 || !isUser(result.user)) throw new MobileAuthError('INVALID_RESPONSE');
        beginAuthSession(result.token, result.user);
        return result.user;
      } catch (error) {
        if (error instanceof MobileAuthError) throw error;
        throw new MobileAuthError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
      } finally { clearTimeout(timeout); }
    },
    /** Clear local credentials immediately. Server-side logout is best-effort and never logs errors. */
    async signOut(): Promise<void> {
      const previous = currentAccessToken();
      clearAuthSession();
      if (!previous) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await fetcher(`${base}/auth/logout`, {
          method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${previous}` }, signal: controller.signal,
        });
      } catch { /* Local sign-out remains complete even if backend is unavailable. */ }
      finally { clearTimeout(timeout); }
    },
  });
}
