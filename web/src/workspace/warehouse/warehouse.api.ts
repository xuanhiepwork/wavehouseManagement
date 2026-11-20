import type { AuthSession } from '../auth';

export type WorkShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type DayType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';
export type Branch = { id: string; code: string; name: string };
export type InventoryBalance = {
    branchId: string;
    ingredientId: string;
    code: string;
    name: string;
    unit: string;
    quantity: string;
};
export type BalanceResult = { items: InventoryBalance[]; paginationWarning: string | null };
export type Recommendation = {
    destinationBranchId: string;
    destinationBranchCode: string;
    destinationBranchName: string;
    ingredientId: string;
    ingredientCode: string;
    ingredientName: string;
    unit: string;
    onHand: string;
    predictedConsumption: string;
    requestedQuantity: string;
    proposedDeliveryQuantity: string;
    unfulfilledQuantity: string;
    historySamples: number;
    forecastMethod: string;
};
export type ForecastPlan = {
    businessDate: string;
    shift: WorkShift;
    dayType: DayType;
    sourceBranch: Branch;
    historyWindowDays: number;
    safetyMultiplier: string;
    recommendations: Recommendation[];
    fetchedAt: string;
    destinationBranchIds: string[];
};
export type ForecastInput = {
    businessDate: string;
    shift: WorkShift;
    sourceBranchId: string;
    destinationBranchIds: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^\d+(?:\.\d{1,6})?$/;
export function isUuid(value: string): boolean { return UUID.test(value); }
export function isQuantity(value: string): boolean {
    return DECIMAL.test(value) && Number.isFinite(Number(value)) && Number(value) < 1e12;
}
export function quantityScaled(value: string): bigint {
    if (!isQuantity(value)) throw new Error('Số lượng phải không âm, tối đa 6 chữ số thập phân.');
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function text(value: unknown): string {
    return typeof value === 'string' ? value
        : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
function number(value: unknown): number {
    const result = Number(value);
    return Number.isFinite(result) && result >= 0 ? result : 0;
}
function unwrap(payload: unknown): Record<string, unknown> {
    const root = object(payload);
    if (!root) throw new Error('API không trả đối tượng JSON hợp lệ.');
    return object(root.data) ?? root;
}
function list(payload: unknown, keys: string[]): unknown[] {
    if (Array.isArray(payload)) return payload;
    const root = object(payload);
    const nodes = [root, object(root?.data)];
    for (const node of nodes) {
        if (!node) continue;
        for (const key of keys) if (Array.isArray(node[key])) return node[key] as unknown[];
    }
    if (Array.isArray(root?.data)) return root.data as unknown[];
    throw new Error('API trả danh sách không đúng cấu trúc dự kiến; cần đối chiếu Backend.');
}
async function request(session: AuthSession, path: string): Promise<unknown> {
    const response = await fetch(`/api${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
    });
    const content = await response.text();
    let payload: unknown;
    try { payload = content ? JSON.parse(content) as unknown : null; }
    catch { throw new Error(`API trả dữ liệu không phải JSON (HTTP ${response.status}).`); }
    if (!response.ok) {
        if (response.status === 401) throw new Error('Phiên đăng nhập hết hạn; hãy đăng nhập lại.');
        if (response.status === 403) throw new Error('Bạn không được phép xem dữ liệu này.');
        const root = object(payload);
        throw new Error(text(root?.error ?? root?.message) || `API lỗi HTTP ${response.status}.`);
    }
    return payload;
}
function parseBranch(value: unknown): Branch {
    const node = object(value);
    const id = text(node?.id);
    if (!isUuid(id)) throw new Error('API chi nhánh thiếu ID hợp lệ.');
    return { id, code: text(node?.code), name: text(node?.name) || id };
}
export async function loadBranches(session: AuthSession): Promise<Branch[]> {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được tải danh sách chi nhánh toàn hệ thống.');
    const payload = await request(session, '/branches');
    const items = list(payload, ['items', 'branches', 'results']);
    if (items.length > 1000) throw new Error('Danh sách chi nhánh vượt giới hạn hiển thị.');
    return items.map(parseBranch);
}
export async function loadBalances(session: AuthSession, branchId: string): Promise<BalanceResult> {
    if (!isUuid(branchId)) throw new Error('Chi nhánh không hợp lệ.');
    if (session.user.role === 'STAFF') throw new Error('Tài khoản không có quyền xem tổng tồn kho.');
    if (session.user.role !== 'ADMIN' && session.user.branchId !== branchId) {
        throw new Error('Chỉ được xem tồn kho chi nhánh của mình.');
    }
    const payload = await request(session, `/inventory/balances?branchId=${encodeURIComponent(branchId)}`);
    const raw = list(payload, ['items', 'balances', 'results']);
    if (raw.length > 5000) throw new Error('Dữ liệu vượt giới hạn, cần API phân trang.');
    const items = raw.map(value => {
        const node = object(value);
        const ingredient = object(node?.ingredient);
        const ingredientId = text(node?.ingredientId ?? ingredient?.id);
        const receivedBranchId = text(node?.branchId ?? branchId);
        const quantity = text(node?.quantity ?? node?.onHand ?? node?.balance);
        if (!isUuid(ingredientId) || !isUuid(receivedBranchId) || !isQuantity(quantity)) {
            throw new Error('API tồn kho trả dòng dữ liệu thiếu ID/số lượng. Cần đối chiếu B3.');
        }
        return {
            branchId: receivedBranchId,
            ingredientId,
            code: text(node?.ingredientCode ?? ingredient?.code),
            name: text(node?.ingredientName ?? ingredient?.name) || ingredientId,
            unit: text(node?.unit ?? ingredient?.unit) || '—',
            quantity,
        };
    }).filter(item => item.branchId === branchId);
    const root = object(payload);
    const data = object(root?.data);
    const meta = object(root?.pagination) ?? object(data?.pagination) ?? object(root?.meta) ?? object(data?.meta);
    const total = meta?.total ?? meta?.totalItems ?? root?.total ?? data?.total;
    const totalCount = typeof total === 'number' ? total : typeof total === 'string' && /^\d+$/.test(total) ? Number(total) : null;
    const paginationWarning = totalCount !== null && totalCount > raw.length
        ? `API chỉ trả ${raw.length}/${totalCount} bản ghi; bảng này chưa đầy đủ.`
        : (meta?.hasNextPage === true || meta?.hasMore === true)
            ? 'API còn trang tiếp theo; dữ liệu tồn kho trên màn hình chưa đầy đủ.'
            : 'Cần đối chiếu cơ chế phân trang API B3 trước khi coi đây là toàn bộ tồn kho.';
    return { items, paginationWarning };
}
function dateValid(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validBusinessDate(value: string): boolean { return dateValid(value); }
function parseRecommendation(value: unknown): Recommendation {
    const node = object(value);
    if (!node) throw new Error('Dòng đề xuất không hợp lệ.');
    const raw = {
        destinationBranchId: text(node.destinationBranchId),
        destinationBranchCode: text(node.destinationBranchCode),
        destinationBranchName: text(node.destinationBranchName),
        ingredientId: text(node.ingredientId),
        ingredientCode: text(node.ingredientCode),
        ingredientName: text(node.ingredientName),
        unit: text(node.unit),
        onHand: text(node.onHand),
        predictedConsumption: text(node.predictedConsumption),
        requestedQuantity: text(node.requestedQuantity),
        proposedDeliveryQuantity: text(node.proposedDeliveryQuantity),
        unfulfilledQuantity: text(node.unfulfilledQuantity),
        historySamples: number(node.historySamples),
        forecastMethod: text(node.forecastMethod),
    };
    if (!isUuid(raw.destinationBranchId) || !isUuid(raw.ingredientId)) {
        throw new Error('Đề xuất thiếu mã chi nhánh/nguyên liệu.');
    }
    for (const amount of [raw.onHand, raw.predictedConsumption, raw.requestedQuantity, raw.proposedDeliveryQuantity, raw.unfulfilledQuantity]) {
        if (!isQuantity(amount)) throw new Error('Đề xuất có số lượng không đúng định dạng.');
    }
    if (quantityScaled(raw.proposedDeliveryQuantity) > quantityScaled(raw.requestedQuantity)) {
        throw new Error('Lượng đề xuất giao lớn hơn lượng yêu cầu.');
    }
    return raw;
}
export async function loadForecast(session: AuthSession, input: ForecastInput): Promise<ForecastPlan> {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được lập kế hoạch phân bổ toàn hệ thống.');
    if (!dateValid(input.businessDate) || !isUuid(input.sourceBranchId)) throw new Error('Ngày hoặc kho nguồn không hợp lệ.');
    if (!['MORNING', 'AFTERNOON', 'EVENING'].includes(input.shift)) throw new Error('Ca không hợp lệ.');
    const destinations = [...new Set(input.destinationBranchIds)];
    if (destinations.length < 1 || destinations.length > 10 || destinations.some(id => !isUuid(id) || id === input.sourceBranchId)) {
        throw new Error('Chọn 1–10 chi nhánh nhận, không bao gồm kho nguồn.');
    }
    const query = new URLSearchParams({
        sourceBranchId: input.sourceBranchId,
        destinationBranchIds: destinations.join(','),
        businessDate: input.businessDate,
        shift: input.shift,
    });
    const root = unwrap(await request(session, `/restock-planning/recommendations?${query.toString()}`));
    const dayType = root.dayType;
    const shift = root.shift;
    const businessDate = text(root.businessDate);
    if (!dateValid(businessDate) || !['MORNING', 'AFTERNOON', 'EVENING'].includes(text(shift)) ||
        !['WEEKDAY', 'WEEKEND', 'HOLIDAY'].includes(text(dayType))) {
        throw new Error('API B7 trả ngày, ca hoặc loại ngày không hợp lệ.');
    }
    const branch = parseBranch(root.sourceBranch);
    if (branch.id !== input.sourceBranchId) throw new Error('API trả kho nguồn không khớp yêu cầu.');
    const recommendations = list(root, ['recommendations']).map(parseRecommendation);
    if (recommendations.length > 5000) throw new Error('Quá nhiều dòng đề xuất.');
    if (recommendations.some(item => !destinations.includes(item.destinationBranchId))) {
        throw new Error('API trả đề xuất ngoài danh sách chi nhánh nhận.');
    }
    return {
        businessDate,
        shift: shift as WorkShift,
        dayType: dayType as DayType,
        sourceBranch: branch,
        historyWindowDays: number(root.historyWindowDays),
        safetyMultiplier: text(root.safetyMultiplier),
        recommendations,
        fetchedAt: new Date().toISOString(),
        destinationBranchIds: destinations,
    };
}
export function displayQuantity(value: string): string {
    if (!isQuantity(value)) return value;
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(Number(value));
}
