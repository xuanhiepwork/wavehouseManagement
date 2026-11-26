import type { AuthSession } from '../auth';
import { listOperationalBranches } from '../operational-branches.api';
import { apiRequest } from '../api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
export const INVENTORY_PAGE_SIZE = 50;

export type InventoryBranch = { id: string; code: string; name: string; isActive: boolean };
export type InventoryIngredient = {
    id: string; code: string; name: string; unit: 'g' | 'ml' | 'piece'; minStock: string; isActive: boolean;
};
export type Balance = {
    branchId: string; ingredientId: string; quantity: string; updatedAt: string; ingredient: InventoryIngredient;
};
export type Movement = {
    id: string; branchId: string; ingredientId: string; actorId: string; kind: string; sourceId: string;
    delta: string; quantityAfter: string; createdAt: string; ingredient: InventoryIngredient;
};
export type InventoryPageResult<T> = { items: T[]; page: number; total: number };

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dữ liệu kho không hợp lệ.');
    return value as Record<string, unknown>;
}
function text(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new Error('Dữ liệu kho thiếu trường bắt buộc.');
    return value;
}
function id(value: unknown): string {
    const result = text(value);
    if (!UUID.test(result)) throw new Error('Mã định danh kho không hợp lệ.');
    return result;
}
function decimal(value: unknown, signed = false): string {
    const result = text(value);
    if (!DECIMAL.test(result) || (!signed && result.startsWith('-'))) throw new Error('Số lượng kho không hợp lệ.');
    return result;
}
function timestamp(value: unknown): string {
    const result = text(value);
    if (!Number.isFinite(Date.parse(result))) throw new Error('Thời gian kho không hợp lệ.');
    return result;
}
function ingredient(value: unknown, expectedId: string): InventoryIngredient {
    const row = record(value);
    if (id(row.id) !== expectedId || (row.unit !== 'g' && row.unit !== 'ml' && row.unit !== 'piece') || typeof row.isActive !== 'boolean') {
        throw new Error('Phản hồi kho thiếu thông tin nguyên liệu đáng tin cậy.');
    }
    return { id: expectedId, code: text(row.code), name: text(row.name), unit: row.unit, minStock: decimal(row.minStock), isActive: row.isActive };
}
function parsePage<T>(value: unknown, page: number, parse: (row: Record<string, unknown>) => T): InventoryPageResult<T> {
    const root = record(value);
    if (!Array.isArray(root.items) || root.page !== page || typeof root.total !== 'number' || !Number.isSafeInteger(root.total) || root.total < 0 || root.items.length > INVENTORY_PAGE_SIZE) {
        throw new Error('Phân trang kho không hợp lệ.');
    }
    return { items: root.items.map(value => parse(record(value))), page, total: root.total };
}
function query(session: AuthSession, branchId: string, page: number, ingredientId?: string): string {
    if (!UUID.test(branchId) || !Number.isSafeInteger(page) || page < 1 || (ingredientId && !UUID.test(ingredientId))) throw new Error('Bộ lọc kho không hợp lệ.');
    // G2: server checks assigned branches, not the old session.branchId.
    const params = new URLSearchParams({ branchId, page: String(page) });
    if (ingredientId) params.set('ingredientId', ingredientId);
    return params.toString();
}

export async function loadInventoryBranches(session: AuthSession, _signal?: AbortSignal): Promise<InventoryBranch[]> {
    const rows = await listOperationalBranches(session);
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, isActive: row.isActive }));
}

export async function loadInventoryBalances(session: AuthSession, branchId: string, page: number, signal?: AbortSignal): Promise<InventoryPageResult<Balance>> {
    const params = query(session, branchId, page);
    return parsePage(await apiRequest<unknown>(session, `/inventory/balances?${params}`, { signal }), page, row => {
        const ingredientId = id(row.ingredientId);
        if (id(row.branchId) !== branchId) throw new Error('Máy chủ trả dữ liệu ngoài chi nhánh đã chọn.');
        return { branchId, ingredientId, quantity: decimal(row.quantity, true), updatedAt: timestamp(row.updatedAt), ingredient: ingredient(row.ingredient, ingredientId) };
    });
}

const movementKinds = new Set(['OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT_ADJUSTMENT', 'RECIPE_CONSUMPTION']);
export async function loadInventoryMovements(session: AuthSession, branchId: string, page: number, ingredientId?: string, signal?: AbortSignal): Promise<InventoryPageResult<Movement>> {
    const params = query(session, branchId, page, ingredientId);
    return parsePage(await apiRequest<unknown>(session, `/inventory/movements?${params}`, { signal }), page, row => {
        const rowIngredientId = id(row.ingredientId);
        if (id(row.branchId) !== branchId || (ingredientId && rowIngredientId !== ingredientId) || !movementKinds.has(text(row.kind))) throw new Error('Máy chủ trả lịch sử ngoài bộ lọc đã chọn.');
        return { id: id(row.id), branchId, ingredientId: rowIngredientId, actorId: id(row.actorId), kind: text(row.kind), sourceId: id(row.sourceId),
            delta: decimal(row.delta, true), quantityAfter: decimal(row.quantityAfter, true), createdAt: timestamp(row.createdAt), ingredient: ingredient(row.ingredient, rowIngredientId) };
    });
}

export function formatInventoryQuantity(value: string): string {
    const [integer, fraction = ''] = value.split('.');
    const digits = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const trimmed = fraction.replace(/0+$/, '');
    return trimmed ? `${digits},${trimmed}` : digits;
}
export function belowMinimum(balance: Balance): boolean {
    const scaled = (value: string) => {
        const negative = value.startsWith('-');
        const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
        const amount = BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
        return negative ? -amount : amount;
    };
    return scaled(balance.quantity) < scaled(balance.ingredient.minStock);
}
