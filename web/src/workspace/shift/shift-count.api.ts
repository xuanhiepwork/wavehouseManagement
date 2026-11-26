import type { AuthSession } from '../auth';
import { ApiError, apiRequest, type ApiRequestOptions } from '../api';
import { listOperationalBranches } from '../operational-branches.api';

export type WorkShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type CountStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';

export type IngredientLine = {
    ingredientId: string;
    code: string;
    name: string;
    unit: string;
    expectedQuantity: string | null;
    countedQuantity: string;
};

export type ShiftCount = {
    id: string;
    branchId: string;
    businessDate: string;
    shift: WorkShift;
    status: CountStatus;
    note: string;
    returnReason: string;
    items: IngredientLine[];
};

export type BranchItem = { id: string; code: string; name: string };

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function string(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

function dateOnly(value: unknown): string {
    const valueAsString = string(value);
    return valueAsString.slice(0, 10);
}

function extractArray(response: unknown, keys: string[]): unknown[] | null {
    if (Array.isArray(response)) return response;
    const outer = asObject(response);
    if (!outer) return null;
    for (const key of keys) {
        if (Array.isArray(outer[key])) return outer[key] as unknown[];
    }
    if (Array.isArray(outer.data)) return outer.data as unknown[];
    const data = asObject(outer.data);
    if (data) {
        for (const key of keys) {
            if (Array.isArray(data[key])) return data[key] as unknown[];
        }
    }
    return null;
}

function singleObject(payload: unknown): Record<string, unknown> {
    const root = asObject(payload);
    if (!root) throw new Error('Phản hồi API không đúng định dạng JSON object.');
    const data = asObject(root.data);
    return asObject(data?.count) ?? asObject(root.count) ?? data ?? root;
}

function asStatus(value: unknown): CountStatus {
    if (value === 'DRAFT' || value === 'SUBMITTED' || value === 'RETURNED' || value === 'APPROVED') {
        return value;
    }
    throw new Error('Backend trả trạng thái phiếu kiểm kê không hợp lệ.');
}

function asShift(value: unknown): WorkShift {
    if (value === 'MORNING' || value === 'AFTERNOON' || value === 'EVENING') return value;
    throw new Error('Backend trả ca kiểm kê không hợp lệ.');
}

function ingredientLine(raw: unknown): IngredientLine {
    const item = asObject(raw);
    if (!item) throw new Error('Dòng nguyên liệu không đúng định dạng.');
    const ingredient = asObject(item.ingredient);
    const ingredientId = string(item.ingredientId || ingredient?.id || item.id);
    if (!UUID_PATTERN.test(ingredientId)) {
        throw new Error('Danh sách kiểm kê thiếu ingredientId hợp lệ.');
    }
    const counted = item.countedQuantity;
    const expected = item.expectedQuantity ?? item.systemQuantity ?? item.balanceQuantity ?? item.stockQuantity ?? item.quantity ?? item.onHand;
    return {
        ingredientId,
        code: string(ingredient?.code || item.code),
        name: string(ingredient?.name || item.name) || ingredientId,
        unit: string(ingredient?.unit || item.unit) || '—',
        expectedQuantity: expected === null || expected === undefined ? null : string(expected),
        countedQuantity: counted === null || counted === undefined ? '' : string(counted),
    };
}

function parseCount(raw: unknown): ShiftCount {
    const obj = singleObject(raw);
    const id = string(obj.id);
    if (!UUID_PATTERN.test(id)) throw new Error('Phiếu kiểm kê thiếu ID hợp lệ.');
    if (!UUID_PATTERN.test(string(obj.branchId))) throw new Error('Phiếu kiểm kê thiếu chi nhánh hợp lệ.');
    const items = extractArray(obj, ['items']);
    return {
        id,
        branchId: string(obj.branchId),
        businessDate: dateOnly(obj.businessDate),
        shift: asShift(obj.shift),
        status: asStatus(obj.status),
        note: string(obj.note),
        returnReason: string(obj.returnReason),
        items: items?.map(ingredientLine) ?? [],
    };
}

async function request(session: AuthSession, path: string, options: ApiRequestOptions = {}): Promise<unknown> {
    try {
        return await apiRequest<unknown>(session, path, options);
    } catch (cause) {
        if (cause instanceof ApiError) {
            const receivingMessages: Record<string, string> = {
                PENDING_TRANSFER_RECEIPTS: 'Còn phiếu chuyển kho POSTED chưa xác nhận nhận hàng. Hoàn tất nhận hàng đầu ca, kiểm đếm lại rồi gửi/duyệt kiểm kê.',
                RECEIVING_SNAPSHOT_CHANGED: 'Mốc nhận hàng đã thay đổi hoặc phiếu được gửi trước W7.2. Quản lý cần trả phiếu, nhân viên kiểm đếm và gửi lại.',
                INVENTORY_SNAPSHOT_CHANGED: 'Tồn kho đã thay đổi hoặc phiếu thiếu mốc tồn W7.2. Quản lý cần trả phiếu, nhân viên kiểm đếm và gửi lại.',
            };
            if (receivingMessages[cause.code]) throw new ApiError(receivingMessages[cause.code], cause.status, cause.code, cause.uncertain);
        }
        throw cause;
    }
}

function assertBranch(session: AuthSession, branchId: string) {
    if (!UUID_PATTERN.test(branchId)) throw new Error('Mã chi nhánh không hợp lệ.');
    // G2: Backend verifies exact assigned area, branch, business date and shift.
}

async function allPages(session: AuthSession, path: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let page = 1; ; page++) {
        const response = asObject(await request(session, `${path}${path.includes('?') ? '&' : '?'}page=${page}`));
        if (!response || !Array.isArray(response.items) || response.page !== page || typeof response.total !== 'number'
            || !Number.isSafeInteger(response.total) || response.total < 0 || response.items.length > 50) {
            throw new Error('Phản hồi phân trang không hợp lệ. Vui lòng tải lại.');
        }
        result.push(...response.items);
        if (page * 50 >= response.total) return result;
        if (!response.items.length) throw new Error('Danh sách bị thiếu trang. Vui lòng tải lại.');
    }
}

export async function loadTemplate(session: AuthSession, branchId: string, businessDate?: string, shift?: WorkShift): Promise<IngredientLine[]> {
    assertBranch(session, branchId);
    const query = new URLSearchParams({ branchId, ...(businessDate ? { businessDate } : {}), ...(shift ? { shift } : {}) });
    const response = await request(session, `/shift-stock-counts/template?${query.toString()}`);
    if (asObject(response)?.branchId !== branchId) throw new Error('Template trả về ngoài chi nhánh đã chọn.');
    const entries = extractArray(response, ['items', 'ingredients']);
    if (!entries) throw new Error('Template không chứa items/ingredients. Cần đối chiếu cấu trúc API B6.');
    if (!entries.length) throw new Error('Chi nhánh hiện không có nguyên liệu để kiểm kê.');
    const items = entries.map(ingredientLine);
    const unique = new Set(items.map(item => item.ingredientId));
    if (unique.size !== items.length) throw new Error('Template chứa nguyên liệu trùng nhau.');
    return items;
}

export async function loadBranchList(session: AuthSession, businessDate?: string, shift?: WorkShift): Promise<BranchItem[]> {
    const rows = await listOperationalBranches(session, businessDate, shift);
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name }));
}

export async function listCounts(session: AuthSession, branchId: string, filters?: { businessDate: string; shift: WorkShift }): Promise<ShiftCount[]> {
    assertBranch(session, branchId);
    const query = new URLSearchParams({ branchId, ...(filters ?? {}) });
    const counts = (await allPages(session, `/shift-stock-counts?${query.toString()}`)).map(parseCount);
    if (counts.some(count => count.branchId !== branchId || (filters && (count.businessDate !== filters.businessDate || count.shift !== filters.shift)))) {
        throw new Error('Danh sách kiểm kê nằm ngoài chi nhánh/ngày/ca đã chọn.');
    }
    if (new Set(counts.map(count => count.id)).size !== counts.length || (filters && counts.length > 1)) {
        throw new Error('Danh sách kiểm kê trùng hoặc đã thay đổi. Vui lòng tải lại trước khi xử lý.');
    }
    return counts;
}

export async function getCount(session: AuthSession, countId: string): Promise<ShiftCount> {
    if (!UUID_PATTERN.test(countId)) throw new Error('Mã phiếu không hợp lệ.');
    const result = await request(session, `/shift-stock-counts/${countId}`);
    const count = parseCount(result);
    if (count.id !== countId) throw new Error('Máy chủ trả về phiếu khác yêu cầu.');
    assertBranch(session, count.branchId);
    return count;
}

export type SaveCountInput = {
    branchId: string;
    businessDate: string;
    shift: WorkShift;
    note: string;
    items: { ingredientId: string; countedQuantity: string }[];
};

export async function createCount(session: AuthSession, payload: SaveCountInput): Promise<string> {
    assertBranch(session, payload.branchId);
    const response = await request(session, '/shift-stock-counts', {
        method: 'POST',
        body: payload,
    });
    const root = asObject(response);
    const id = string((asObject(root?.data) ?? root)?.id);
    if (!UUID_PATTERN.test(id)) throw new ApiError('Backend đã phản hồi nhưng thiếu ID của phiếu kiểm kê. Đối chiếu danh sách trước khi lưu lại.', 200, 'INVALID_RESPONSE', true);
    return id;
}

export async function updateCount(session: AuthSession, countId: string, payload: Pick<SaveCountInput, 'note' | 'items'>): Promise<void> {
    await request(session, `/shift-stock-counts/${countId}`, {
        method: 'PATCH',
        body: payload,
    });
}

export async function submitCount(session: AuthSession, countId: string): Promise<void> {
    await request(session, `/shift-stock-counts/${countId}/submit`, { method: 'POST' });
}

export async function approveCount(session: AuthSession, countId: string): Promise<void> {
    await request(session, `/shift-stock-counts/${countId}/approve`, { method: 'POST' });
}

export async function returnCount(session: AuthSession, countId: string, returnReason: string): Promise<void> {
    await request(session, `/shift-stock-counts/${countId}/return`, {
        method: 'POST',
        body: { reason: returnReason },
    });
}
