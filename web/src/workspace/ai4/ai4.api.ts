/** AI4 uses only the existing ADMIN-protected B7 GET route. No Python call from browser. */
import type { AuthSession } from '../auth';
import {
    asRecord, parseAI4Response, UUID, validDate,
    type AI4View, type Shift
} from './ai4.logic';

export type Branch = { id: string; name: string; code: string };
export type AI4Input = {
    businessDate: string;
    shift: Shift;
    sourceBranchId: string;
    destinationBranchIds: string[];
};
const MAX_BODY = 3 * 1024 * 1024;

async function apiGet(session: AuthSession, endpoint: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`/api${endpoint}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
        cache: 'no-store', signal,
    });
    const length = response.headers.get('content-length');
    if (length && Number(length) > MAX_BODY) throw new Error('Phản hồi máy chủ quá lớn để hiển thị.');
    const raw = await response.text();
    if (raw.length > MAX_BODY) throw new Error('Phản hồi máy chủ vượt giới hạn hiển thị.');
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch { throw new Error(`API trả phản hồi không hợp lệ (HTTP ${response.status}).`); }
    if (!response.ok) {
        if (response.status === 401) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        if (response.status === 403) throw new Error('Bạn không được cấp quyền lập kế hoạch dự báo B7/AI.');
        if (response.status === 429) throw new Error('Máy chủ đang giới hạn yêu cầu. Vui lòng thử lại sau.');
        const detail = asRecord(data);
        const supplied = detail?.error ?? detail?.message;
        throw new Error(typeof supplied === 'string' && supplied.length <= 400 ? supplied : `API lỗi HTTP ${response.status}.`);
    }
    return data;
}
function assertAdmin(session: AuthSession): void {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được truy cập dữ liệu dự báo và kế hoạch bổ sung.');
}
function branchRow(value: unknown): Branch {
    const row = asRecord(value);
    if (!row || typeof row.id !== 'string' || !UUID.test(row.id)) {
        throw new Error('Danh sách chi nhánh chứa ID không hợp lệ.');
    }
    return {
        id: row.id, name: typeof row.name === 'string' ? row.name : row.id,
        code: typeof row.code === 'string' ? row.code : '',
    };
}
export async function listAllBranches(session: AuthSession, signal?: AbortSignal): Promise<Branch[]> {
    assertAdmin(session);
    const branches: Branch[] = [];
    const seen = new Set<string>();
    // The existing B2 backend supports a fixed 50-item page; never silently use page 1 only.
    for (let page = 1; page <= 100; page++) {
        const payload = asRecord(await apiGet(session, `/branches?page=${page}`, signal));
        if (!payload || !Array.isArray(payload.items)
            || typeof payload.total !== 'number' || !Number.isInteger(payload.total)
            || payload.total < 0 || payload.total > 5000) {
            throw new Error('API chi nhánh trả phân trang không hợp lệ.');
        }
        const items = payload.items.map(branchRow);
        if (items.length > 50 || (items.length === 0 && branches.length < payload.total)) {
            throw new Error('Danh sách chi nhánh thiếu trang dữ liệu.');
        }
        for (const item of items) {
            if (seen.has(item.id)) throw new Error('Danh sách chi nhánh có ID lặp lại.');
            seen.add(item.id);
            branches.push(item);
        }
        if (branches.length >= payload.total) {
            if (branches.length !== payload.total) throw new Error('Số chi nhánh và tổng phân trang không khớp.');
            return branches;
        }
    }
    throw new Error('Danh sách chi nhánh vượt 100 trang; cần API tìm kiếm riêng.');
}
export async function fetchAI4View(session: AuthSession, input: AI4Input, signal?: AbortSignal): Promise<AI4View> {
    assertAdmin(session);
    if (!validDate(input.businessDate) || !['MORNING', 'AFTERNOON', 'EVENING'].includes(input.shift)) {
        throw new Error('Ngày kinh doanh hoặc ca không hợp lệ.');
    }
    if (!UUID.test(input.sourceBranchId)) throw new Error('Chi nhánh kho nguồn không hợp lệ.');
    const destinations = [...new Set(input.destinationBranchIds)];
    if (destinations.length < 1 || destinations.length > 10
        || destinations.some(id => !UUID.test(id) || id === input.sourceBranchId)) {
        throw new Error('Chọn từ 1 đến 10 chi nhánh nhận khác kho nguồn.');
    }
    const query = new URLSearchParams({
        businessDate: input.businessDate,
        shift: input.shift,
        sourceBranchId: input.sourceBranchId,
        destinationBranchIds: destinations.join(','),
    });
    const raw = await apiGet(session, `/restock-planning/recommendations?${query.toString()}`, signal);
    const parsed = parseAI4Response(raw);
    if (parsed.businessDate !== input.businessDate || parsed.shift !== input.shift) {
        throw new Error('API trả kết quả không đúng ngày hoặc ca đã chọn.');
    }
    const data = asRecord(asRecord(raw)?.data);
    const source = asRecord(data?.sourceBranch);
    if (source?.id !== input.sourceBranchId) throw new Error('API trả kế hoạch có kho nguồn không khớp.');
    if (parsed.rows.some(row => !destinations.includes(row.destinationBranchId))) {
        throw new Error('API trả chi nhánh nhận ngoài phạm vi yêu cầu.');
    }
    return parsed;
}
