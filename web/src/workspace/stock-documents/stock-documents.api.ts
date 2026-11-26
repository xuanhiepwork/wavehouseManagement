import type { AuthSession } from '../auth';
import { ApiError, apiRequest } from '../api';
import { listOperationalBranches } from '../operational-branches.api';

export type DocumentKind = 'receipt' | 'issue' | 'transfer';
export type DocumentStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type DocumentLine = { ingredientId: string; quantity: string; unitCost?: string };
export type TransferReceivingSummary = { id: string; status: 'DRAFT' | 'CONFIRMED'; version: number; confirmedAt: string | null };
export type StockDocument = {
    id: string; code: string; status: DocumentStatus;
    branchId?: string; sourceBranchId?: string; destinationBranchId?: string | null;
    supplierName?: string | null; note?: string | null;
    createdById?: string; postedById?: string | null;
    createdAt: string; updatedAt?: string; postedAt: string | null;
    items?: DocumentLine[];
    legacyReceivingRequired?: boolean; transferReceipt?: TransferReceivingSummary | null;
};
export type DocumentPage = { items: StockDocument[]; page: number; total: number };
export type DocumentFilter = { branchId?: string; destinationBranchId?: string; status?: DocumentStatus; code?: string };
export type DocumentInput = {
    code: string; branchId: string; destinationBranchId?: string;
    supplierName?: string | null; note?: string | null; items: DocumentLine[];
};
export type IngredientOption = {
    id: string; code: string; name: string; unit: 'g' | 'ml' | 'piece';
    minStock: string; costPrice: string; isActive: boolean;
};
export type BranchOption = { id: string; code: string; name: string; isActive: boolean };
export type SourceBalance = { ingredientId: string; quantity: string; updatedAt?: string };

const paths: Record<DocumentKind, string> = {
    receipt: '/goods-receipts', issue: '/stock-issues', transfer: '/stock-transfers',
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isDocumentId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const decimal = (value: unknown): value is string => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
const signedQuantity = (value: unknown): value is string => typeof value === 'string' && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value);
function malformed(): never { throw new Error('Dữ liệu chứng từ từ máy chủ không hợp lệ.'); }
function guardPage(length: number, page: number, total: number, limit: number): void {
    if (length > limit || length > total || (length === 0 && (page - 1) * limit < total)) malformed();
}
function document(value: unknown, detail = false): StockDocument {
    if (!object(value) || !isDocumentId(value.id) || typeof value.code !== 'string' ||
        !['DRAFT', 'POSTED', 'CANCELLED'].includes(String(value.status)) || typeof value.createdAt !== 'string' ||
        !(value.postedAt === null || typeof value.postedAt === 'string') ||
        !(isDocumentId(value.branchId) || isDocumentId(value.sourceBranchId))) return malformed();
    if (value.destinationBranchId !== undefined && value.destinationBranchId !== null && !isDocumentId(value.destinationBranchId)) return malformed();
    if (value.legacyReceivingRequired !== undefined && typeof value.legacyReceivingRequired !== 'boolean') return malformed();
    if (value.transferReceipt !== undefined && value.transferReceipt !== null) {
        const receipt = value.transferReceipt;
        if (!object(receipt) || !isDocumentId(receipt.id) || (receipt.status !== 'DRAFT' && receipt.status !== 'CONFIRMED') ||
            !integer(receipt.version) || receipt.version < 1 || !(receipt.confirmedAt === null ||
                (typeof receipt.confirmedAt === 'string' && !Number.isNaN(Date.parse(receipt.confirmedAt))))) return malformed();
    }
    if (detail && (!Array.isArray(value.items) || !value.items.every(line => object(line) && isDocumentId(line.ingredientId) && decimal(line.quantity) &&
        (line.unitCost === undefined || decimal(line.unitCost))))) return malformed();
    return value as unknown as StockDocument;
}
export async function listDocuments(session: AuthSession, kind: DocumentKind, page: number, filter: DocumentFilter = {}, signal?: AbortSignal): Promise<DocumentPage> {
    const query = new URLSearchParams({ page: String(page) });
    if (filter.branchId) {
        if (!isDocumentId(filter.branchId)) throw new Error('Chi nhánh lọc không hợp lệ.');
        query.set(kind === 'receipt' ? 'branchId' : 'sourceBranchId', filter.branchId);
    }
    if (kind === 'transfer' && filter.destinationBranchId) query.set('destinationBranchId', filter.destinationBranchId);
    if (kind !== 'receipt' && filter.status) query.set('status', filter.status);
    if (kind !== 'receipt' && filter.code) query.set('code', filter.code);
    const value = await apiRequest<unknown>(session, `${paths[kind]}?${query}`, { signal });
    if (!object(value) || !Array.isArray(value.items) || !integer(value.total) || value.page !== page) return malformed();
    guardPage(value.items.length, page, value.total, 50);
    const items = value.items.map(item => document(item));
    if (new Set(items.map(item => item.id.toLowerCase())).size !== items.length) return malformed();
    return { items, total: value.total, page };
}
export async function getDocument(session: AuthSession, kind: DocumentKind, id: string, signal?: AbortSignal): Promise<StockDocument> {
    if (!isDocumentId(id)) throw new Error('Mã định danh chứng từ không hợp lệ.');
    const value = await apiRequest<unknown>(session, `${paths[kind]}/${encodeURIComponent(id)}`, { signal });
    if (!object(value)) return malformed();
    const result = document(value.data, true);
    if (result.id !== id) return malformed();
    return result;
}
export async function saveDocument(session: AuthSession, kind: DocumentKind, input: DocumentInput, id?: string): Promise<StockDocument> {
    const body = id
        ? { note: input.note ?? null, ...(kind === 'receipt' ? { supplierName: input.supplierName ?? null } : {}), items: input.items }
        : { code: input.code, ...(kind === 'receipt' ? { branchId: input.branchId, supplierName: input.supplierName ?? null } : {
            sourceBranchId: input.branchId, ...(kind === 'transfer' ? { destinationBranchId: input.destinationBranchId } : {}),
        }), note: input.note ?? null, items: input.items };
    const value = await apiRequest<unknown>(session, `${paths[kind]}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body });
    if (!object(value)) return malformed();
    return document(value.data, true);
}
export async function changeDocumentStatus(session: AuthSession, kind: DocumentKind, id: string, action: 'post' | 'cancel'): Promise<StockDocument> {
    const value = await apiRequest<unknown>(session, `${paths[kind]}/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    if (action === 'cancel') {
        if (!object(value) || value.status !== 'CANCELLED') return malformed();
        // The cancellation endpoint deliberately returns a status, not a detail envelope.
        try { return await getDocument(session, kind, id); }
        catch { throw new ApiError('Máy chủ đã báo hủy phiếu nhưng chưa tải được chi tiết. Kiểm tra trạng thái trước khi thao tác tiếp.', 0, 'READ_AFTER_WRITE', true); }
    }
    if (!object(value)) return malformed();
    return document(value.data, true);
}
/** Read-only recovery after an uncertain create. The database keeps document codes unique. */
export async function findDocumentByCode(session: AuthSession, kind: DocumentKind, code: string): Promise<StockDocument | null> {
    let page = 1;
    const seen = new Set<string>();
    for (;;) {
        const result = await listDocuments(session, kind, page, kind === 'receipt' ? {} : { code });
        for (const item of result.items) {
            const id = item.id.toLowerCase();
            if (seen.has(id)) return malformed();
            seen.add(id);
        }
        const found = result.items.find(item => item.code === code);
        if (found) return getDocument(session, kind, found.id);
        if (page * 50 >= result.total) return null;
        page += 1;
    }
}
export async function createTransferDraft(session: AuthSession, input: {
    code: string; sourceBranchId: string; destinationBranchId: string; note?: string | null;
    items: { ingredientId: string; quantity: string }[];
}): Promise<StockDocument> {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được tạo phiếu điều chuyển.');
    return saveDocument(session, 'transfer', { ...input, branchId: input.sourceBranchId });
}
export const findTransferByCode = (session: AuthSession, code: string) => findDocumentByCode(session, 'transfer', code);

export async function loadDocumentIngredients(session: AuthSession, signal?: AbortSignal): Promise<IngredientOption[]> {
    const result = new Map<string, IngredientOption>();
    // Catalog defaults to active=true; historical documents also need inactive ingredient metadata.
    for (const isActive of [true, false]) {
        let page = 1;
        const seen = new Set<string>();
        for (;;) {
            const value = await apiRequest<unknown>(session, `/ingredients?page=${page}&limit=100&isActive=${isActive}&sortBy=code&sortOrder=asc`, { signal });
            if (!object(value) || !Array.isArray(value.data) || !object(value.pagination) || value.pagination.page !== page ||
                !integer(value.pagination.totalPages) || !integer(value.pagination.total) || value.pagination.limit !== 100 ||
                value.pagination.totalPages !== Math.ceil(value.pagination.total / 100)) return malformed();
            guardPage(value.data.length, page, value.pagination.total, 100);
            for (const raw of value.data) {
                if (!object(raw) || !isDocumentId(raw._id) || typeof raw.code !== 'string' || typeof raw.name !== 'string' ||
                    !['g', 'ml', 'piece'].includes(String(raw.unit)) || !decimal(raw.minStock) || !decimal(raw.costPrice) || raw.isActive !== isActive) return malformed();
                const id = raw._id.toLowerCase();
                if (seen.has(id)) return malformed();
                seen.add(id);
                // An ingredient may change activity between the two reads. Keep one UUID entry with the later metadata.
                result.set(id, { id, code: raw.code, name: raw.name, unit: raw.unit as IngredientOption['unit'],
                    minStock: raw.minStock, costPrice: raw.costPrice, isActive });
            }
            if (page >= value.pagination.totalPages) break;
            page += 1;
        }
    }
    return [...result.values()].sort((a, b) => a.code.localeCompare(b.code));
}
export async function loadDocumentBranches(session: AuthSession, signal?: AbortSignal): Promise<BranchOption[]> {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const rows = await listOperationalBranches(session);
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, isActive: row.isActive }));
}
export async function loadSourceBalances(session: AuthSession, branchId: string, signal?: AbortSignal): Promise<SourceBalance[]> {
    if (!isDocumentId(branchId)) return [];
    const result: SourceBalance[] = [];
    const seen = new Set<string>();
    let page = 1;
    for (;;) {
        const value = await apiRequest<unknown>(session, `/inventory/balances?branchId=${encodeURIComponent(branchId)}&page=${page}`, { signal });
        if (!object(value) || !Array.isArray(value.items) || !integer(value.total) || value.page !== page) return malformed();
        guardPage(value.items.length, page, value.total, 50);
        for (const raw of value.items) {
            if (!object(raw) || !isDocumentId(raw.ingredientId) || raw.branchId !== branchId || !signedQuantity(raw.quantity)) return malformed();
            const id = raw.ingredientId.toLowerCase();
            if (seen.has(id)) return malformed();
            seen.add(id);
            result.push({ ingredientId: raw.ingredientId, quantity: raw.quantity,
                ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}) });
        }
        if (page * 50 >= value.total) return result;
        page += 1;
    }
}
