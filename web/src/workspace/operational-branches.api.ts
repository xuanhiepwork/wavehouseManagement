import type { AuthSession } from './auth';
import { apiRequest } from './api';
export type OperationalBranch = { id: string; code: string; name: string; isActive: boolean };
export async function listOperationalBranches(session: AuthSession, businessDate?: string, shift?: string): Promise<OperationalBranch[]> {
    const q = new URLSearchParams();
    if (businessDate) q.set('businessDate', businessDate);
    if (shift) q.set('shift', shift);
    const payload = await apiRequest<unknown>(session, '/operational-branches' + (q.size ? `?${q.toString()}` : ''));
    const root = payload as { items?: unknown };
    if (!root || !Array.isArray(root.items)) throw new Error('Máy chủ không trả danh sách quầy theo phân công.');
    return root.items.map(value => {
        const row = value as Record<string, unknown>;
        if (!row || typeof row.id !== 'string' || typeof row.code !== 'string' ||
            typeof row.name !== 'string' || typeof row.isActive !== 'boolean') {
            throw new Error('Phạm vi quầy từ máy chủ không hợp lệ.');
        }
        return { id: row.id, code: row.code, name: row.name, isActive: row.isActive };
    });
}
