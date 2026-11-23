import type { AuthSession } from './auth';

export const SESSION_EXPIRED_EVENT = 'wavehouse:session-expired';

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly uncertain: boolean;
    constructor(message: string, status = 0, code = '', uncertain = false) {
        super(message);
        this.name = 'ApiError'; this.status = status; this.code = code; this.uncertain = uncertain;
    }
}

/** One transport, no token store and no automatic retries, including after timeouts. */
export async function authenticatedFetch(token: string | undefined, url: string, options: RequestInit = {},
    fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetcher(url, { ...options, headers, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (token && response.status === 401 && typeof window !== 'undefined') {
        // A late response from an old request must not expire a newly restored session.
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { matches: (candidate: string) => candidate === token } }));
    }
    return response;
}

export function sessionFetch(session: Pick<AuthSession, 'token'>, path: string, options: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('Đường dẫn API không hợp lệ.');
    return authenticatedFetch(session.token, `/api${path}`, options);
}

export type ApiRequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
export async function apiRequest<T>(session: Pick<AuthSession, 'token'>, path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const writing = method !== 'GET' && method !== 'HEAD';
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = window.setTimeout(abort, 20000);
    try {
        let response: Response;
        try {
            response = await sessionFetch(session, path, { method, signal: controller.signal,
                ...(options.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }) });
        } catch {
            throw new ApiError(writing
                ? 'Không nhận được phản hồi. Yêu cầu có thể đã được lưu; đối chiếu dữ liệu trên máy chủ trước khi gửi lại.'
                : 'Không thể kết nối máy chủ hoặc yêu cầu đã hết thời gian. Hãy tải lại khi kết nối ổn định.', 0, 'NETWORK', writing);
        }
        let payload: unknown = null;
        try { if (response.status !== 204) payload = await response.json(); }
        catch {
            if (response.ok) throw new ApiError('Phản hồi không đúng định dạng. Hãy đối chiếu bản ghi trên máy chủ.', response.status, 'INVALID_RESPONSE', writing);
        }
        if (!response.ok) {
            const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
            const messages: Record<number, string> = {
                401: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Dữ liệu đang nhập vẫn được giữ; hãy xác thực lại.',
                403: 'Tài khoản không có quyền thực hiện thao tác hoặc truy cập chi nhánh này.',
                404: 'Không tìm thấy bản ghi trong phạm vi truy cập của tài khoản.',
                409: 'Dữ liệu đã tồn tại, đã thay đổi hoặc trạng thái không cho phép. Đối chiếu bản mới nhất trước khi tiếp tục.',
            };
            const reason = response.status === 400 && typeof root.error === 'string' ? root.error.slice(0, 500) : '';
            throw new ApiError(messages[response.status] ?? (reason || `Máy chủ chưa xử lý được yêu cầu (HTTP ${response.status}).`),
                response.status, typeof root.code === 'string' ? root.code : '', writing && response.status >= 500);
        }
        return payload as T;
    } finally {
        window.clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
    }
}
