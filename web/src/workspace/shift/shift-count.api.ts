import type { AuthSession } from '../auth';

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

async function request(session: AuthSession, path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${session.token}`,
            ...options.headers,
        },
        cache: 'no-store',
    });
    const content = await response.text();
    let payload: unknown = null;
    if (content) {
        try { payload = JSON.parse(content) as unknown; }
        catch { throw new Error(`API trả dữ liệu không phải JSON (HTTP ${response.status}).`); }
    }
    if (!response.ok) {
        const detail = asObject(payload);
        const reason = string(detail?.error || detail?.message);
        const message = reason || `Yêu cầu thất bại (HTTP ${response.status}).`;
        if (response.status === 401) throw new Error(`Phiên đăng nhập đã hết hạn. ${message}`);
        if (response.status === 409) throw new Error(`Xung đột dữ liệu: ${message}. Hãy tải lại phiếu.`);
        throw new Error(message);
    }
    return payload;
}

export async function loadTemplate(session: AuthSession, branchId: string): Promise<IngredientLine[]> {
    const response = await request(session, `/shift-stock-counts/template?branchId=${encodeURIComponent(branchId)}`);
    const entries = extractArray(response, ['items', 'ingredients']);
    if (!entries) throw new Error('Template không chứa items/ingredients. Cần đối chiếu cấu trúc API B6.');
    if (!entries.length) throw new Error('Chi nhánh hiện không có nguyên liệu để kiểm kê.');
    const items = entries.map(ingredientLine);
    const unique = new Set(items.map(item => item.ingredientId));
    if (unique.size !== items.length) throw new Error('Template chứa nguyên liệu trùng nhau.');
    return items;
}

export async function loadBranchList(session: AuthSession): Promise<BranchItem[]> {
    const response = await request(session, '/branches');
    const rows = extractArray(response, ['items', 'branches']);
    if (!rows) throw new Error('Không đọc được danh sách chi nhánh.');
    return rows.map(value => {
        const obj = asObject(value);
        return { id: string(obj?.id), code: string(obj?.code), name: string(obj?.name) };
    }).filter(item => UUID_PATTERN.test(item.id));
}

export async function listCounts(session: AuthSession, branchId: string): Promise<ShiftCount[]> {
    const response = await request(session, `/shift-stock-counts?branchId=${encodeURIComponent(branchId)}`);
    const rows = extractArray(response, ['items', 'counts', 'results']);
    if (!rows) throw new Error('API danh sách kiểm kê chưa trả mảng items/counts.');
    return rows.map(parseCount);
}

export async function getCount(session: AuthSession, countId: string): Promise<ShiftCount> {
    const result = await request(session, `/shift-stock-counts/${countId}`);
    return parseCount(result);
}

export type SaveCountInput = {
    branchId: string;
    businessDate: string;
    shift: WorkShift;
    note: string;
    items: { ingredientId: string; countedQuantity: string }[];
};

export async function createCount(session: AuthSession, payload: SaveCountInput): Promise<string> {
    const response = await request(session, '/shift-stock-counts', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    const id = string(singleObject(response).id);
    if (!UUID_PATTERN.test(id)) throw new Error('Backend đã phản hồi nhưng thiếu ID của phiếu kiểm kê. Kiểm tra danh sách trước khi lưu lại.');
    return id;
}

export async function updateCount(session: AuthSession, countId: string, payload: Pick<SaveCountInput, 'note' | 'items'>): Promise<void> {
    await request(session, `/shift-stock-counts/${countId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
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
        body: JSON.stringify({ reason: returnReason }),
    });
}
