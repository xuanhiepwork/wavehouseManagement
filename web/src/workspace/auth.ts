/** WaveHouse W1 session adapter. No credentials or tokens are logged. */
import { ApiError, apiRequest } from './api';
export type UserRole = 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';

export type AuthUser = {
    id: string;
    role: UserRole;
    email: string;
    displayName: string;
    branchId: string | null;
    areaId: string | null;
    workKind: 'SALES' | 'KITCHEN_DELIVERY';
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

const TOKEN_KEY = 'wavehouse.session.token';

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readToken(payload: unknown): string | null {
    const root = record(payload);
    const data = record(root?.data);
    const candidate = root?.token ?? root?.accessToken ?? data?.token ?? data?.accessToken;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function readUser(payload: unknown): AuthUser {
    const root = record(payload);
    const data = record(root?.data);
    const candidate = record(root?.user) ?? record(data?.user) ?? data ?? root;

    if (!candidate) throw new Error('Máy chủ không trả thông tin người dùng.');

    const { id, role, email, displayName, branchId, areaId, workKind } = candidate;
    if (
        typeof id !== 'string' ||
        (role !== 'ADMIN' && role !== 'BRANCH_MANAGER' && role !== 'STAFF')
    ) {
        throw new Error('Dữ liệu phiên đăng nhập không hợp lệ.');
    }

    return {
        id,
        role,
        email: typeof email === 'string' ? email : '',
        displayName: typeof displayName === 'string' ? displayName : '',
        branchId: typeof branchId === 'string' ? branchId : null,
        areaId: typeof areaId === 'string' ? areaId : null,
        workKind: workKind === 'KITCHEN_DELIVERY' ? 'KITCHEN_DELIVERY' : 'SALES',
    };
}

export async function getCurrentUser(token: string): Promise<AuthUser> {
    return readUser(await apiRequest<unknown>({ token }, '/auth/me'));
}

export async function signIn(email: string, password: string, expectedUserId?: string,
    expectedScope?: Pick<AuthUser, 'role' | 'branchId'>): Promise<AuthSession> {
    let payload: unknown;
    try {
        payload = await apiRequest<unknown>({ token: '' }, '/auth/login', { method: 'POST', body: { email: email.trim(), password } });
    } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) throw new Error('Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị vô hiệu hóa.', { cause });
        throw cause;
    }
    const token = readToken(payload);
    if (!token) throw new Error('Phản hồi đăng nhập thiếu Bearer token.');

    const user = await getCurrentUser(token);
    if (expectedUserId && user.id !== expectedUserId) {
        throw new Error('Hãy xác thực lại bằng tài khoản đang mở để giữ đúng phạm vi dữ liệu. Đăng xuất trước nếu muốn đổi tài khoản.');
    }
    if (expectedScope && (user.role !== expectedScope.role || user.branchId !== expectedScope.branchId)) {
        throw new Error('Phân quyền hoặc chi nhánh đã thay đổi. Hãy sao lưu dữ liệu đang nhập rồi đăng xuất để mở đúng phạm vi mới.');
    }
    sessionStorage.setItem(TOKEN_KEY, token);
    return { token, user };
}

export async function restoreSession(): Promise<AuthSession | null> {
    try {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (!token) return null;
        return { token, user: await getCurrentUser(token) };
    } catch {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage may be unavailable in the browser. */ }
        return null;
    }
}

export async function signOut(token: string): Promise<void> {
    try {
        await apiRequest<unknown>({ token }, '/auth/logout', { method: 'POST' });
    } finally {
        sessionStorage.removeItem(TOKEN_KEY);
    }
}
