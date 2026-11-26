import type { AuthSession } from '../auth';
import { apiRequest } from '../api';
import { loadInventoryBalances, loadInventoryBranches } from '../inventory/inventory.api';

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
    if (value.length > 32 || !DECIMAL.test(value)) return false;
    return value.split('.')[0].replace(/^0+(?=\d)/, '').length <= 12;
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
    return apiRequest<unknown>(session, path);
}
function parseBranch(value: unknown): Branch {
    const node = object(value);
    const id = text(node?.id);
    if (!isUuid(id) || typeof node?.code !== 'string' || !node.code || typeof node.name !== 'string' || !node.name) {
        throw new Error('API chi nhánh thiếu ID, mã hoặc tên hợp lệ.');
    }
    return { id, code: node.code, name: node.name };
}
export async function loadBranches(session: AuthSession): Promise<Branch[]> {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được tải danh sách chi nhánh.');
    return loadInventoryBranches(session);
}
export async function loadBalances(session: AuthSession, branchId: string): Promise<BalanceResult> {
    const items: InventoryBalance[] = [];
    for (let page = 1; ; page++) {
        const result = await loadInventoryBalances(session, branchId, page);
        for (const row of result.items) items.push({ branchId: row.branchId, ingredientId: row.ingredientId,
            code: row.ingredient.code, name: row.ingredient.name, unit: row.ingredient.unit, quantity: row.quantity });
        if (page * 50 >= result.total) return { items, paginationWarning: null };
        if (!result.items.length) throw new Error('Dữ liệu tồn kho thiếu trang. Hãy tải lại.');
    }
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
    if (!raw.destinationBranchCode || !raw.destinationBranchName || !raw.ingredientCode || !raw.ingredientName ||
        !['g', 'ml', 'piece'].includes(raw.unit) || !Number.isSafeInteger(node.historySamples) || Number(node.historySamples) < 0 || !raw.forecastMethod) {
        throw new Error('Đề xuất thiếu metadata nguyên liệu, đơn vị hoặc thông tin lịch sử.');
    }
    for (const amount of [raw.onHand, raw.predictedConsumption, raw.requestedQuantity, raw.proposedDeliveryQuantity, raw.unfulfilledQuantity]) {
        if (!isQuantity(amount)) throw new Error('Đề xuất có số lượng không đúng định dạng.');
    }
    for (const key of ['onHand', 'predictedConsumption', 'requestedQuantity', 'proposedDeliveryQuantity', 'unfulfilledQuantity']) {
        if (typeof node[key] !== 'string') throw new Error('API B7 phải trả số lượng bằng chuỗi thập phân.');
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
    if (businessDate !== input.businessDate || shift !== input.shift || !dateValid(businessDate) || !['MORNING', 'AFTERNOON', 'EVENING'].includes(text(shift)) ||
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
    if (new Set(recommendations.map(row => `${row.destinationBranchId}:${row.ingredientId}`)).size !== recommendations.length) {
        throw new Error('API B7 trả trùng dòng nguyên liệu/điểm nhận.');
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
    const [whole, fraction = ''] = value.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (trimmed ? ',' + trimmed : '');
}
