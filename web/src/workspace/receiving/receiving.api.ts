import type { AuthSession } from '../auth';
import { sessionFetch } from '../api';

export type BranchOption = { id: string; code: string; name: string };
export type ReceiptStatus = 'DRAFT' | 'CONFIRMED';
export type ReceiptSummary = { id: string; status: ReceiptStatus; version: number; confirmedAt: string | null };
export type TransferSummary = {
    id: string; number: string; sourceBranchId: string; destinationBranchId: string;
    postedAt: string | null; legacyReceivingRequired: boolean; receipt: ReceiptSummary | null;
};
export type TransferLine = {
    ingredientId: string; code: string; name: string; unit: 'g' | 'ml' | 'piece'; plannedQuantity: string;
};
export type ReceivingItem = TransferLine & {
    receivedQuantity: string; damagedQuantity: string; usableQuantity: string;
    shortageQuantity: string; overageQuantity: string; hasDiscrepancy: boolean; discrepancyReason: string | null;
};
export type ReceivingDocument = ReceiptSummary & {
    stockDocumentId: string; note: string | null; createdById: string; receivedById: string | null;
    createdAt: string; updatedAt: string; discrepancyCount: number; items: ReceivingItem[];
    physicalReceivedAt: string | null; legacyEvidence: string | null;
};
export type ReceivingDetails = {
    transfer: {
        id: string; code: string; status: 'POSTED'; inventoryPosted: true;
        sourceBranchId: string; destinationBranchId: string; sourceBranch: BranchOption; destinationBranch: BranchOption;
        postedAt: string | null; legacyReceivingRequired: boolean; items: TransferLine[];
    };
    receipt: ReceivingDocument | null;
    receivingStatus: 'AWAITING_RECEIVING' | ReceiptStatus;
    adjustsInventory: false;
    allowedActions: { canCreate: boolean; canEdit: boolean; canConfirm: boolean };
};
export type ReceivingInput = {
    note: string;
    physicalReceivedAt?: string; legacyEvidence?: string;
    items: { ingredientId: string; receivedQuantity: string; damagedQuantity: string; discrepancyReason: string | null }[];
};
export type ReceivingPageResult = { items: TransferSummary[]; page: number; total: number; totalPages: number };
export type ReceivingFilter = 'ALL' | ReceiptStatus;

export class ReceivingApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly outcomeUnknown: boolean;
    constructor(message: string, status = 0, code = '', outcomeUnknown = false) {
        super(message); this.status = status; this.code = code; this.outcomeUnknown = outcomeUnknown;
    }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
export function isBranchId(value: string): boolean { return UUID.test(value); }
function object(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReceivingApiError('Phản hồi máy chủ không hợp lệ.');
    return raw as Record<string, unknown>;
}
function text(raw: unknown): string {
    if (typeof raw !== 'string') throw new ReceivingApiError('Phản hồi máy chủ thiếu chuỗi dữ liệu.');
    return raw;
}
function id(raw: unknown): string {
    const result = text(raw);
    if (!UUID.test(result)) throw new ReceivingApiError('Phản hồi máy chủ thiếu ID hợp lệ.');
    return result;
}
function nullableText(raw: unknown): string | null { return raw === null ? null : text(raw); }
function boolean(raw: unknown): boolean {
    if (typeof raw !== 'boolean') throw new ReceivingApiError('Phản hồi thiếu phân loại chuyển kho lịch sử.');
    return raw;
}
function integer(raw: unknown, min = 0): number {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min) throw new ReceivingApiError('Thông tin phân trang/phiên bản không hợp lệ.');
    return raw;
}
function quantity(raw: unknown): string {
    const result = text(raw);
    if (!DECIMAL.test(result)) throw new ReceivingApiError('Số lượng từ máy chủ không hợp lệ.');
    return result;
}
function array(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) throw new ReceivingApiError('Máy chủ không trả danh sách.');
    return raw;
}
function branch(raw: unknown): BranchOption {
    const node = object(raw);
    return { id: id(node.id), code: text(node.code), name: text(node.name) };
}
function receiptSummary(raw: unknown): ReceiptSummary {
    const node = object(raw);
    if (node.status !== 'DRAFT' && node.status !== 'CONFIRMED') throw new ReceivingApiError('Trạng thái biên bản không hợp lệ.');
    return { id: id(node.id), status: node.status, version: integer(node.version, 1), confirmedAt: nullableText(node.confirmedAt) };
}
function transferLine(raw: unknown): TransferLine {
    const node = object(raw);
    if (node.unit !== 'g' && node.unit !== 'ml' && node.unit !== 'piece') throw new ReceivingApiError('Đơn vị nguyên liệu không hợp lệ.');
    return { ingredientId: id(node.ingredientId), code: text(node.code), name: text(node.name),
        unit: node.unit, plannedQuantity: quantity(node.plannedQuantity) };
}
function parseDetails(raw: unknown): ReceivingDetails {
    const node = object(raw);
    const transfer = object(node.transfer);
    const actions = object(node.allowedActions);
    if (transfer.status !== 'POSTED' || transfer.inventoryPosted !== true || node.adjustsInventory !== false ||
        typeof actions.canCreate !== 'boolean' || typeof actions.canEdit !== 'boolean' || typeof actions.canConfirm !== 'boolean') {
        throw new ReceivingApiError('Contract giao nhận không hợp lệ.');
    }
    let receipt: ReceivingDocument | null = null;
    if (node.receipt !== null) {
        const saved = object(node.receipt);
        const items = array(saved.items).map(rawItem => {
            const item = object(rawItem);
            if (typeof item.hasDiscrepancy !== 'boolean') throw new ReceivingApiError('Thông tin chênh lệch không hợp lệ.');
            return { ...transferLine(item), receivedQuantity: quantity(item.receivedQuantity),
                damagedQuantity: quantity(item.damagedQuantity), usableQuantity: quantity(item.usableQuantity),
                shortageQuantity: quantity(item.shortageQuantity), overageQuantity: quantity(item.overageQuantity),
                hasDiscrepancy: item.hasDiscrepancy, discrepancyReason: nullableText(item.discrepancyReason) };
        });
        receipt = { ...receiptSummary(saved), stockDocumentId: id(saved.stockDocumentId), note: nullableText(saved.note),
            physicalReceivedAt: nullableText(saved.physicalReceivedAt), legacyEvidence: nullableText(saved.legacyEvidence),
            createdById: id(saved.createdById), receivedById: saved.receivedById === null ? null : id(saved.receivedById),
            createdAt: text(saved.createdAt), updatedAt: text(saved.updatedAt), discrepancyCount: integer(saved.discrepancyCount), items };
    }
    if (node.receivingStatus !== (receipt?.status ?? 'AWAITING_RECEIVING')) throw new ReceivingApiError('Trạng thái giao nhận không nhất quán.');
    const transferId = id(transfer.id);
    const sourceBranch = branch(transfer.sourceBranch);
    const destinationBranch = branch(transfer.destinationBranch);
    const items = array(transfer.items).map(transferLine);
    if (!items.length || new Set(items.map(item => item.ingredientId)).size !== items.length ||
        (receipt && (receipt.stockDocumentId !== transferId || receipt.items.length !== items.length ||
            new Set(receipt.items.map(item => item.ingredientId)).size !== items.length ||
            receipt.items.some(item => !items.some(line => line.ingredientId === item.ingredientId))))) {
        throw new ReceivingApiError('Danh sách nguyên liệu không khớp phiếu chuyển kho.');
    }
    if (sourceBranch.id !== id(transfer.sourceBranchId) || destinationBranch.id !== id(transfer.destinationBranchId)) {
        throw new ReceivingApiError('Chi nhánh giao nhận không nhất quán.');
    }
    const legacyReceivingRequired = boolean(transfer.legacyReceivingRequired);
    if (receipt && (legacyReceivingRequired
        ? (!receipt.physicalReceivedAt || !Number.isFinite(Date.parse(receipt.physicalReceivedAt)) || !receipt.legacyEvidence?.trim())
        : (receipt.physicalReceivedAt !== null || receipt.legacyEvidence !== null))) {
        throw new ReceivingApiError('Biên bản lịch sử thiếu hoặc sai thông tin đối chiếu.');
    }
    return { transfer: { id: transferId, code: text(transfer.code), status: 'POSTED', inventoryPosted: true,
        sourceBranchId: sourceBranch.id, destinationBranchId: destinationBranch.id, sourceBranch, destinationBranch,
        postedAt: nullableText(transfer.postedAt), legacyReceivingRequired, items }, receipt,
        receivingStatus: receipt?.status ?? 'AWAITING_RECEIVING', adjustsInventory: false,
        allowedActions: { canCreate: actions.canCreate, canEdit: actions.canEdit, canConfirm: actions.canConfirm } };
}
async function request(session: AuthSession, path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const writing = method !== 'GET';
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
        let response: Response;
        try {
            response = await sessionFetch(session, path, { method, headers: {
                Authorization: 'Bearer ' + session.token, ...(writing ? { 'Content-Type': 'application/json' } : {}),
            }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', signal: controller.signal });
        } catch {
            throw new ReceivingApiError(writing
                ? 'Mất kết nối. Chưa biết yêu cầu đã được lưu hay chưa; hãy tải lại biên bản trước khi thao tác tiếp.'
                : 'Không thể kết nối máy chủ. Hãy thử tải lại.', 0, 'NETWORK', writing);
        }
        let payload: unknown;
        try { payload = await response.json() as unknown; }
        catch { throw new ReceivingApiError('Phản hồi không hợp lệ. Hãy tải lại biên bản.', response.status, 'INVALID_RESPONSE', writing); }
        if (!response.ok) {
            const root = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload as Record<string, unknown> : {};
            const code = typeof root.code === 'string' ? root.code : '';
            const messages: Record<number, string> = {
                401: 'Phiên đăng nhập hết hạn. Xác thực lại cùng tài khoản ở thông báo phía trên; biểu mẫu đang nhập được giữ.',
                403: 'Bạn không có quyền thao tác với chi nhánh hoặc biên bản này.',
                404: 'Không tìm thấy phiếu hoặc phiếu không thuộc phạm vi được phân quyền.',
                409: 'Biên bản đã thay đổi hoặc trạng thái không cho phép. Tải lại dữ liệu trước khi tiếp tục.',
            };
            const reason = response.status === 400 && typeof root.error === 'string' ? root.error : '';
            throw new ReceivingApiError(messages[response.status] || reason || 'Máy chủ chưa xử lý được yêu cầu.',
                response.status, code, writing && response.status >= 500);
        }
        return payload;
    } finally { window.clearTimeout(timer); }
}
async function detailRequest(session: AuthSession, path: string, method = 'GET', body?: unknown): Promise<ReceivingDetails> {
    const payload = await request(session, path, method, body);
    try {
        const detail = parseDetails(object(payload).data);
        if (method !== 'GET' && !detail.receipt) throw new Error('Missing persisted receipt');
        if (path.endsWith('/confirm') && detail.receipt?.status !== 'CONFIRMED') throw new Error('Confirmation not verified');
        return detail;
    }
    catch (error) {
        if (method !== 'GET') throw new ReceivingApiError('Máy chủ đã phản hồi nhưng dữ liệu chưa xác minh được. Tải lại biên bản.', 0, 'INVALID_RESPONSE', true);
        throw error;
    }
}
function transferSummary(raw: unknown): TransferSummary {
    const node = object(raw);
    if (node.status !== 'POSTED') throw new ReceivingApiError('Danh sách chứa phiếu chưa hạch toán.');
    return { id: id(node.id), number: text(node.code), sourceBranchId: id(node.sourceBranchId),
        destinationBranchId: id(node.destinationBranchId), postedAt: nullableText(node.postedAt),
        legacyReceivingRequired: boolean(node.legacyReceivingRequired),
        receipt: node.transferReceipt === null ? null : receiptSummary(node.transferReceipt) };
}
export async function getReceivingBranches(session: AuthSession): Promise<BranchOption[]> {
    const result: BranchOption[] = [];
    for (let page = 1; page <= 100; page++) {
        const payload = object(await request(session, '/branches?page=' + page));
        const items = array(payload.items).map(branch);
        result.push(...items);
        if (result.length >= integer(payload.total)) return result;
        if (!items.length) throw new ReceivingApiError('Phân trang chi nhánh không đầy đủ.');
    }
    throw new ReceivingApiError('Danh sách chi nhánh vượt giới hạn tải. Cần thu hẹp phạm vi.');
}
export async function listPostedTransfers(session: AuthSession, destinationBranchId: string, page: number, filter: ReceivingFilter): Promise<ReceivingPageResult> {
    if (!UUID.test(destinationBranchId)) throw new ReceivingApiError('Hãy chọn chi nhánh hợp lệ.');
    const query = new URLSearchParams({ destinationBranchId, page: String(page) });
    if (filter === 'ALL') query.set('status', 'POSTED'); else query.set('status', filter);
    const payload = object(await request(session, (filter === 'ALL' ? '/stock-transfers?' : '/transfer-receipts?') + query.toString()));
    const items = filter === 'ALL' ? array(payload.items).map(transferSummary) : array(payload.items).map(raw => {
        const detail = parseDetails(raw);
        return { id: detail.transfer.id, number: detail.transfer.code, sourceBranchId: detail.transfer.sourceBranchId,
            destinationBranchId: detail.transfer.destinationBranchId, postedAt: detail.transfer.postedAt,
            legacyReceivingRequired: detail.transfer.legacyReceivingRequired, receipt: detail.receipt };
    });
    if (items.some(item => item.destinationBranchId !== destinationBranchId)) throw new ReceivingApiError('Danh sách có phiếu ngoài chi nhánh nhận.');
    const total = integer(payload.total);
    if (integer(payload.page, 1) !== page) throw new ReceivingApiError('Trang dữ liệu không khớp yêu cầu.');
    return { items, page, total, totalPages: Math.max(1, Math.ceil(total / 50)) };
}
export function getTransferReceiving(session: AuthSession, transferId: string): Promise<ReceivingDetails> {
    return detailRequest(session, '/stock-transfers/' + encodeURIComponent(transferId) + '/receipt');
}
export function createReceipt(session: AuthSession, transferId: string, input: ReceivingInput): Promise<ReceivingDetails> {
    return detailRequest(session, '/stock-transfers/' + encodeURIComponent(transferId) + '/receipt', 'POST', input);
}
export function updateReceipt(session: AuthSession, receiptId: string, expectedVersion: number, input: ReceivingInput): Promise<ReceivingDetails> {
    return detailRequest(session, '/transfer-receipts/' + encodeURIComponent(receiptId), 'PATCH', { expectedVersion, ...input });
}
export function confirmReceipt(session: AuthSession, receiptId: string, expectedVersion: number): Promise<ReceivingDetails> {
    return detailRequest(session, '/transfer-receipts/' + encodeURIComponent(receiptId) + '/confirm', 'POST', { expectedVersion });
}
function scaled(value: string): bigint {
    if (!DECIMAL.test(value)) throw new Error('Số lượng không hợp lệ.');
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
function unscaled(value: bigint): string {
    const fraction = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
    return String(value / 1000000n) + (fraction ? '.' + fraction : '');
}
export function validQuantity(value: string, unit: string): boolean {
    return DECIMAL.test(value) && (unit !== 'piece' || scaled(value) % 1000000n === 0n);
}
export function calculateReceiving(received: string, damaged: string, planned: string) {
    const actual = scaled(received), bad = scaled(damaged), expected = scaled(planned);
    if (bad > actual) throw new Error('Số hỏng không được vượt số thực nhận.');
    return { usableQuantity: unscaled(actual - bad), shortageQuantity: unscaled(expected > actual ? expected - actual : 0n),
        overageQuantity: unscaled(actual > expected ? actual - expected : 0n),
        hasDiscrepancy: actual !== expected || bad > 0n };
}
