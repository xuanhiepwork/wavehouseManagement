/** WaveHouse W1 session adapter. No credentials or tokens are logged. */
export type UserRole = 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';

export type AuthUser = {
    id: string;
    role: UserRole;
    email: string;
    displayName: string;
    branchId: string | null;
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

    const { id, role, email, displayName, branchId } = candidate;
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
    };
}

async function readResponse(response: Response): Promise<unknown> {
    const content = await response.text();
    let payload: unknown;

    try {
        payload = content ? JSON.parse(content) as unknown : null;
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const details = record(payload);
        const message = typeof details?.error === 'string' ? details.error : '';
        if (response.status === 401) {
            throw new Error('Email hoặc mật khẩu không đúng, hoặc phiên đã hết hạn.');
        }
        throw new Error(message || `Máy chủ trả lỗi HTTP ${response.status}.`);
    }

    return payload;
}

export async function getCurrentUser(token: string): Promise<AuthUser> {
    const response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    return readUser(await readResponse(response));
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
    });

    const payload = await readResponse(response);
    const token = readToken(payload);
    if (!token) throw new Error('Phản hồi đăng nhập thiếu Bearer token.');

    const user = await getCurrentUser(token);
    sessionStorage.setItem(TOKEN_KEY, token);
    return { token, user };
}

export async function restoreSession(): Promise<AuthSession | null> {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    try {
        return { token, user: await getCurrentUser(token) };
    } catch {
        sessionStorage.removeItem(TOKEN_KEY);
        return null;
    }
}

export async function signOut(token: string): Promise<void> {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        await readResponse(response);
    } finally {
        sessionStorage.removeItem(TOKEN_KEY);
    }
}
