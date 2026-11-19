import type { AuthSession } from '../auth';

export type BranchOption = { id: string; code: string; name: string };
export type TransferSummary = {
    id: string;
    number: string;
    status: string;
    sourceBranchId: string;
    destinationBranchId: string;
    postedAt: string | null;
    note: string;
};
export type TransferLine = {
    ingredientId: string;
    code: string;
    name: string;
    unit: string;
    plannedQuantity: string;
};
export type TransferDetails = TransferSummary & { items: TransferLine[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function str(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
function unwrap(payload: unknown): Record<string, unknown> {
    const root = object(payload);
    if (!root) throw new Error('API không trả đối tượng JSON hợp lệ.');
    return object(root.data) ?? root;
}
function rows(payload: unknown, names: string[]): unknown[] {
    if (Array.isArray(payload)) return payload;
    const root = object(payload);
    const data = object(root?.data);
    for (const node of [root, data]) {
        if (!node) continue;
        for (const name of names) {
            if (Array.isArray(node[name])) return node[name] as unknown[];
        }
    }
    if (Array.isArray(root?.data)) return root.data;
    throw new Error('API trả danh sách không đúng cấu trúc dự kiến; cần đối chiếu route B5.');
}
async function fetchJson(session: AuthSession, path: string): Promise<unknown> {
    const response = await fetch(`/api${path}`, {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
    });
    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
        try { payload = JSON.parse(raw) as unknown; }
        catch { throw new Error(`Máy chủ trả dữ liệu không phải JSON (HTTP ${response.status}).`); }
    }
    if (!response.ok) {
        if (response.status === 401) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
        if (response.status === 403) throw new Error('Bạn không có quyền xem phiếu chuyển kho này.');
        const root = object(payload);
        const detail = str(root?.error ?? root?.message);
        throw new Error(detail || `Không thể tải dữ liệu (HTTP ${response.status}).`);
    }
    return payload;
}
function summary(value: unknown): TransferSummary {
    const node = object(value);
    if (!node) throw new Error('Phiếu chuyển kho không đúng định dạng.');
    const source = object(node.sourceBranch);
    const destination = object(node.destinationBranch);
    const id = str(node.id);
    const sourceBranchId = str(node.sourceBranchId ?? node.fromBranchId ?? source?.id);
    const destinationBranchId = str(node.destinationBranchId ?? node.toBranchId ?? destination?.id);
    if (!UUID.test(id) || !UUID.test(sourceBranchId) || !UUID.test(destinationBranchId)) {
        throw new Error('Phiếu chuyển kho thiếu mã chi nhánh hoặc ID hợp lệ. Cần đối chiếu API B5.');
    }
    return {
        id,
        number: str(node.number ?? node.code ?? node.documentNo) || id.slice(0, 8).toUpperCase(),
        status: str(node.status),
        sourceBranchId,
        destinationBranchId,
        postedAt: str(node.postedAt ?? node.confirmedAt ?? node.createdAt) || null,
        note: str(node.note),
    };
}
function line(value: unknown): TransferLine {
    const node = object(value);
    if (!node) throw new Error('Dòng nguyên liệu không đúng định dạng.');
    const ingredient = object(node.ingredient);
    const ingredientId = str(node.ingredientId ?? ingredient?.id);
    const quantity = str(node.quantity ?? node.plannedQuantity ?? node.requestedQuantity);
    if (!UUID.test(ingredientId) || !/^(?:\d+)(?:\.\d{1,6})?$/.test(quantity)) {
        throw new Error('Phiếu chuyển kho thiếu ingredientId hoặc quantity hợp lệ.');
    }
    return {
        ingredientId,
        code: str(node.ingredientCode ?? ingredient?.code ?? node.code),
        name: str(node.ingredientName ?? ingredient?.name ?? node.name) || ingredientId,
        unit: str(node.unit ?? ingredient?.unit) || '—',
        plannedQuantity: quantity,
    };
}
export async function getReceivingBranches(session: AuthSession): Promise<BranchOption[]> {
    const payload = await fetchJson(session, '/branches');
    return rows(payload, ['items', 'branches', 'results']).map(value => {
        const item = object(value);
        return { id: str(item?.id), code: str(item?.code), name: str(item?.name) };
    }).filter(branch => UUID.test(branch.id));
}
export async function listPostedTransfers(session: AuthSession, destinationBranchId: string): Promise<TransferSummary[]> {
    if (!UUID.test(destinationBranchId)) throw new Error('Chưa chọn chi nhánh nhận hàng hợp lệ.');
    // B5 has GET /api/stock-transfers. Do not assume filter/pagination parameters.
    const payload = await fetchJson(session, '/stock-transfers');
    return rows(payload, ['items', 'transfers', 'documents', 'results'])
        .map(summary)
        .filter(transfer => transfer.destinationBranchId === destinationBranchId && transfer.status === 'POSTED')
        .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
}
export async function getTransferDetails(session: AuthSession, id: string): Promise<TransferDetails> {
    if (!UUID.test(id)) throw new Error('ID phiếu chuyển kho không hợp lệ.');
    const payload = await fetchJson(session, `/stock-transfers/${encodeURIComponent(id)}`);
    const outer = unwrap(payload);
    const document = object(outer.transfer) ?? object(outer.document) ?? outer;
    const info = summary(document);
    const items = rows(document, ['items', 'stockDocumentItems', 'lines']).map(line);
    if (items.length === 0) throw new Error('Phiếu chưa có dòng nguyên liệu; không thể đối chiếu.');
    const unique = new Set(items.map(item => item.ingredientId));
    if (unique.size !== items.length) throw new Error('Phiếu có nguyên liệu trùng lặp.');
    return { ...info, items };
}

export function validQuantity(value: string, unit: string): boolean {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return false;
    if (unit.toLowerCase() === 'piece' && !/^\d+$/.test(value)) return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed < 1e12;
}

// The UI uses decimal strings, avoiding binary floating-point drift in six-decimal checks.
export function deltaQuantity(actual: string, planned: string): string {
    function scaled(value: string): bigint {
        const [whole, fraction = ''] = value.split('.');
        return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
    }
    const diff = scaled(actual) - scaled(planned);
    const sign = diff < 0n ? '-' : diff > 0n ? '+' : '';
    const absolute = diff < 0n ? -diff : diff;
    const digits = String(absolute % 1000000n).padStart(6, '0').replace(/0+$/, '');
    return `${sign}${absolute / 1000000n}${digits ? `.${digits}` : ''}`;
}

export function lessOrEqual(a: string, b: string): boolean {
    return Number(a) <= Number(b);
}
