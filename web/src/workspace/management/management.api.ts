import type { AuthSession, UserRole } from '../auth';
import { apiRequest } from '../api';

export type ManagedRole = 'STAFF' | 'BRANCH_MANAGER';
export type BranchRecord = {
    id: string; code: string; name: string; isActive: boolean; createdAt: string; updatedAt: string;
};
export type UserRecord = {
    id: string; email: string; displayName: string; role: UserRole; branchId: string | null;
    isActive: boolean; createdAt: string; updatedAt: string;
};
export type Page<T> = { items: T[]; page: number; total: number };
export type UserFilters = { q: string; role: UserRole | ''; branchId: string; isActive: '' | 'true' | 'false' };
export type CreateUserInput = {
    email: string; displayName: string; password: string; role: ManagedRole; branchId: string;
};
export type UserChanges = Partial<Pick<UserRecord, 'displayName' | 'isActive'>> & { branchId?: string; role?: ManagedRole };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Phản hồi quản trị không hợp lệ.');
    return value as Record<string, unknown>;
}
function requiredString(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Phản hồi quản trị thiếu thông tin.');
    return value;
}
function id(value: unknown): string {
    const result = requiredString(value);
    if (!UUID.test(result)) throw new Error('Mã bản ghi từ máy chủ không hợp lệ.');
    return result;
}
function active(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Trạng thái bản ghi không hợp lệ.');
    return value;
}
function branch(value: unknown): BranchRecord {
    const row = record(value);
    return { id: id(row.id), code: requiredString(row.code), name: requiredString(row.name),
        isActive: active(row.isActive), createdAt: requiredString(row.createdAt), updatedAt: requiredString(row.updatedAt) };
}
function user(value: unknown): UserRecord {
    const row = record(value);
    const role = row.role;
    if (role !== 'ADMIN' && role !== 'STAFF' && role !== 'BRANCH_MANAGER') throw new Error('Vai trò từ máy chủ không hợp lệ.');
    return { id: id(row.id), email: requiredString(row.email), displayName: requiredString(row.displayName), role,
        branchId: row.branchId === null ? null : id(row.branchId), isActive: active(row.isActive),
        createdAt: requiredString(row.createdAt), updatedAt: requiredString(row.updatedAt) };
}
function page<T>(value: unknown, parse: (value: unknown) => T): Page<T> {
    const root = record(value);
    if (!Array.isArray(root.items) || typeof root.page !== 'number' || !Number.isSafeInteger(root.page) || root.page < 1 ||
        typeof root.total !== 'number' || !Number.isSafeInteger(root.total) || root.total < 0) throw new Error('Thông tin phân trang không hợp lệ.');
    return { items: root.items.map(parse), page: root.page, total: root.total };
}
function admin(session: AuthSession): void {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được quản trị chi nhánh và tài khoản.');
}
async function detail<T>(session: AuthSession, path: string, parse: (value: unknown) => T,
    options?: { method?: 'POST' | 'PATCH'; body?: unknown }): Promise<T> {
    admin(session);
    const response = record(await apiRequest<unknown>(session, path, options));
    return parse(response.data);
}
export async function listBranches(session: AuthSession, requestedPage: number): Promise<Page<BranchRecord>> {
    admin(session);
    return page(await apiRequest<unknown>(session, `/branches?page=${requestedPage}`), branch);
}
export async function loadBranchOptions(session: AuthSession): Promise<BranchRecord[]> {
    const result: BranchRecord[] = [];
    let currentPage = 1;
    for (;;) {
        const response = await listBranches(session, currentPage);
        result.push(...response.items);
        if (response.page * 50 >= response.total) return result;
        if (!response.items.length) throw new Error('Danh sách chi nhánh thay đổi. Vui lòng tải lại.');
        currentPage += 1;
    }
}
export function getBranch(session: AuthSession, branchId: string): Promise<BranchRecord> {
    return detail(session, `/branches/${encodeURIComponent(branchId)}`, branch);
}
export function createBranch(session: AuthSession, input: { code: string; name: string }): Promise<BranchRecord> {
    return detail(session, '/branches', branch, { method: 'POST', body: input });
}
export function updateBranch(session: AuthSession, branchId: string, input: { name: string; isActive: boolean }): Promise<BranchRecord> {
    return detail(session, `/branches/${encodeURIComponent(branchId)}`, branch, { method: 'PATCH', body: input });
}
export async function listUsers(session: AuthSession, requestedPage: number, filters: UserFilters): Promise<Page<UserRecord>> {
    admin(session);
    const query = new URLSearchParams({ page: String(requestedPage) });
    if (filters.q.trim()) query.set('q', filters.q.trim());
    if (filters.role) query.set('role', filters.role);
    if (filters.branchId) query.set('branchId', filters.branchId);
    if (filters.isActive) query.set('isActive', filters.isActive);
    return page(await apiRequest<unknown>(session, `/users?${query}`), user);
}
export function getUser(session: AuthSession, userId: string): Promise<UserRecord> {
    return detail(session, `/users/${encodeURIComponent(userId)}`, user);
}
export function createUser(session: AuthSession, input: CreateUserInput): Promise<UserRecord> {
    return detail(session, '/users', user, { method: 'POST', body: input });
}
export function updateUser(session: AuthSession, userId: string, input: UserChanges): Promise<UserRecord> {
    return detail(session, `/users/${encodeURIComponent(userId)}`, user, { method: 'PATCH', body: input });
}
export async function resetPassword(session: AuthSession, userId: string, password: string): Promise<void> {
    admin(session);
    await apiRequest<void>(session, `/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST', body: { password } });
}
