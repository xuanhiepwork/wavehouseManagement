import { sessionFetch } from '../api';

export type PaymentChannel = 'CASH' | 'BANK_TRANSFER' | 'MOMO' | 'GRAB' | 'OTHER';
export type SalesShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type SalesStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
export type SalesSize = 'S' | 'M' | 'L' | 'OTHER';
export type SalesInput = {
    branchId: string; businessDate: string; shift: SalesShift; note: string | null; discounts: string;
    lines: { productId: string | null; productName: string; size: SalesSize; quantity: number; unitPrice: string; note: string | null }[];
    payments: { channel: PaymentChannel; collectedAmount: string; refundedAmount: string; platformFee: string; settlementDifference: string; note: string | null }[];
    expenses: { channel: PaymentChannel; description: string; amount: string }[];
    cash: { openingCash: string; cashHandovers: string; closingCashActual: string | null };
};
export type SalesRevision = {
    id: string; reportId: string; number: number; createdById: string; createdAt: string; note: string | null;
    discounts: string; recognizedRefunds: string;
    lines: { id: string; productId: string | null; productNameSnapshot: string; size: SalesSize; quantity: number; unitPriceSnapshot: string; note: string | null }[];
    payments: (SalesInput['payments'][number] & { id: string })[];
    expenses: (SalesInput['expenses'][number] & { id: string })[];
    cash: SalesInput['cash'];
    totals: { grossSales: string; netExpected: string; netRecorded: string; salesDifference: string; expectedCash: string; cashDifference: string | null };
};
export type SalesBranch = { id: string; code?: string; name: string; isActive: boolean };
export type SalesProduct = { _id: string; name: string; isAvailable: boolean; prices: { size: 'S' | 'M' | 'L'; price: string }[] };
export type SalesReport = {
    id: string; branchId: string; branch: SalesBranch; businessDate: string; shift: SalesShift; status: SalesStatus;
    version: number; currentRevisionNumber: number; submittedRevisionNumber: number | null; approvedRevisionNumber: number | null;
    createdById: string; submittedById: string | null; reviewedById: string | null;
    createdAt: string; updatedAt: string; submittedAt: string | null; reviewedAt: string | null; approvedAt: string | null;
    returnReason: string | null; currentRevision: SalesRevision;
    allowedActions: { canEdit: boolean; canSubmit: boolean; canReturn: boolean; canApprove: boolean }; adjustsInventory: false;
};
export type SalesEvent = { id: string; reportId: string; revisionNumber: number; actorId: string;
    type: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'RETURNED' | 'APPROVED'; reason: string | null; createdAt: string };
export type SalesHistory = { revisions: SalesRevision[]; events: SalesEvent[] };

export class SalesApiError extends Error {
    readonly status: number;
    constructor(message: string, status = 0) { super(message); this.status = status; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is string => typeof v === 'string' && /^-?(?:0|[1-9]\d{0,17})$/.test(v);
const channels: readonly string[] = ['CASH', 'BANK_TRANSFER', 'MOMO', 'GRAB', 'OTHER'];
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const nullableAmount = (v: unknown) => v === null || amount(v);
const malformed = (): never => { throw new SalesApiError('Dữ liệu máy chủ không đúng định dạng.'); };
function revision(value: unknown): SalesRevision {
    if (!object(value) || !uuid(value.id) || !uuid(value.reportId) || !integer(value.number) || value.number < 1
        || !object(value.cash) || !object(value.totals) || !Array.isArray(value.lines) || !Array.isArray(value.payments) || !Array.isArray(value.expenses)
        || !uuid(value.createdById) || typeof value.createdAt !== 'string' || !nullableText(value.note)
        || !amount(value.discounts) || !amount(value.recognizedRefunds)
        || !amount(value.cash.openingCash) || !amount(value.cash.cashHandovers) || !nullableAmount(value.cash.closingCashActual)
        || !['grossSales','netExpected','netRecorded','salesDifference','expectedCash'].every(key => amount((value.totals as Record<string, unknown>)[key]))
        || !nullableAmount(value.totals.cashDifference)
        || !value.lines.every(l => object(l) && uuid(l.id) && (l.productId === null || uuid(l.productId))
            && typeof l.productNameSnapshot === 'string' && ['S','M','L','OTHER'].includes(String(l.size))
            && integer(l.quantity) && amount(l.unitPriceSnapshot) && nullableText(l.note))
        || !value.payments.every(p => object(p) && uuid(p.id) && channels.includes(String(p.channel))
            && amount(p.collectedAmount) && amount(p.refundedAmount) && amount(p.platformFee) && amount(p.settlementDifference) && nullableText(p.note))
        || !value.expenses.every(e => object(e) && uuid(e.id) && channels.includes(String(e.channel)) && typeof e.description === 'string' && amount(e.amount))) return malformed();
    return value as unknown as SalesRevision;
}
function report(value: unknown): SalesReport {
    if (!object(value) || !uuid(value.id) || !uuid(value.branchId) || !object(value.branch) || !object(value.allowedActions)
        || !uuid(value.branch.id) || typeof value.branch.name !== 'string' || typeof value.branch.isActive !== 'boolean'
        || !['canEdit','canSubmit','canReturn','canApprove'].every(key => typeof (value.allowedActions as Record<string, unknown>)[key] === 'boolean')
        || !integer(value.version) || value.version < 1 || !integer(value.currentRevisionNumber) || typeof value.businessDate !== 'string'
        || !['MORNING','AFTERNOON','EVENING'].includes(String(value.shift))
        || !['DRAFT','SUBMITTED','RETURNED','APPROVED'].includes(String(value.status))) return malformed();
    const r = revision(value.currentRevision);
    if (r.reportId !== value.id || r.number !== value.currentRevisionNumber) return malformed();
    return value as unknown as SalesReport;
}

/** Same-origin Bearer requests; no token persistence, price coercion or write retries. */
export function createSalesApi(token: string) {
    async function request(path: string, method = 'GET', body?: object): Promise<unknown> {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20000);
        try {
            const response = await sessionFetch({ token }, path, { method, cache: 'no-store', signal: controller.signal,
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            let payload: unknown = null;
            try { payload = await response.json(); } catch { /* Sanitize non-JSON responses. */ }
            if (!response.ok) {
                const messages: Record<number, string> = {
                    401: 'Phiên đăng nhập hết hạn. Xác thực lại cùng tài khoản ở thông báo phía trên; bản nháp đang nhập được giữ.',
                    403: 'Tài khoản không có quyền thực hiện thao tác này.',
                    404: 'Không tìm thấy báo cáo hoặc báo cáo thuộc chi nhánh khác.',
                    409: 'Báo cáo đã tồn tại hoặc đã thay đổi. Dữ liệu đang nhập được giữ; tải bản mới nhất trước khi thử lại.',
                };
                throw new SalesApiError(messages[response.status] ?? (object(payload) && typeof payload.error === 'string'
                    ? payload.error : `Máy chủ trả HTTP ${response.status}.`), response.status);
            }
            return payload;
        } catch (error) {
            if (error instanceof SalesApiError) throw error;
            throw new SalesApiError('Không nhận được phản hồi. Yêu cầu lưu có thể đã hoàn tất; tải lại danh sách/báo cáo trước khi thử lại.');
        } finally { window.clearTimeout(timeout); }
    }
    async function detail(path: string, method = 'GET', body?: object) {
        const payload = await request(path, method, body);
        if (!object(payload)) return malformed();
        return report(payload.data);
    }
    const idPath = (id: string) => {
        if (!uuid(id)) throw new SalesApiError('Mã báo cáo không hợp lệ.');
        return `/sales-reports/${encodeURIComponent(id)}`;
    };
    return {
        async list(query: Record<string, string | number>) {
            const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
            const payload = await request(`/sales-reports?${params}`);
            if (!object(payload) || !Array.isArray(payload.items) || !integer(payload.page) || !integer(payload.total)) return malformed();
            return { items: payload.items.map(report), page: payload.page, total: payload.total };
        },
        async workContext(businessDate: string): Promise<{ branches: SalesBranch[]; assignments: { branchId: string; shift: SalesShift }[] }> {
            const payload = await request(`/sales-reports/work-context?${new URLSearchParams({ businessDate })}`);
            if (!object(payload) || !Array.isArray(payload.branches) || !Array.isArray(payload.assignments) ||
                !payload.branches.every(b => object(b) && uuid(b.id) && typeof b.name === 'string' && typeof b.isActive === 'boolean') ||
                !payload.assignments.every(a => object(a) && uuid(a.branchId) && ['MORNING','AFTERNOON','EVENING'].includes(String(a.shift)))) {
                return malformed();
            }
            return payload as { branches: SalesBranch[]; assignments: { branchId: string; shift: SalesShift }[] };
        },
        get: (id: string) => detail(idPath(id)),
        create: (input: SalesInput) => detail('/sales-reports', 'POST', input),
        update: (id: string, input: SalesInput, expectedVersion: number) => detail(idPath(id), 'PATCH', { ...input, expectedVersion }),
        submit: (id: string, expectedVersion: number) => detail(`${idPath(id)}/submit`, 'POST', { expectedVersion }),
        returnReport: (id: string, expectedVersion: number, revisionNumber: number, reason: string) =>
            detail(`${idPath(id)}/return`, 'POST', { expectedVersion, revisionNumber, reason }),
        approve: (id: string, expectedVersion: number, revisionNumber: number) => detail(`${idPath(id)}/approve`, 'POST', { expectedVersion, revisionNumber }),
        async revisions(id: string): Promise<SalesHistory> {
            const payload = await request(`${idPath(id)}/revisions`);
            if (!object(payload) || !object(payload.data) || !Array.isArray(payload.data.revisions) || !Array.isArray(payload.data.events)) return malformed();
            if (!payload.data.events.every(e => object(e) && uuid(e.id) && uuid(e.actorId) && e.reportId === id && integer(e.revisionNumber)
                && ['CREATED','UPDATED','SUBMITTED','RETURNED','APPROVED'].includes(String(e.type)) && nullableText(e.reason) && typeof e.createdAt === 'string')) return malformed();
            return { revisions: payload.data.revisions.map(revision), events: payload.data.events as SalesEvent[] };
        },
        async products(): Promise<SalesProduct[]> {
            const items: SalesProduct[] = [];
            for (let page = 1; page <= 10000; page++) {
                const payload = await request(`/products?page=${page}&limit=100`);
                if (!object(payload) || !Array.isArray(payload.data) || !object(payload.pagination) || !integer(payload.pagination.totalPages)) return malformed();
                for (const p of payload.data) {
                    if (!object(p) || !uuid(p._id) || typeof p.name !== 'string' || typeof p.isAvailable !== 'boolean' || !Array.isArray(p.prices)
                        || !p.prices.every(v => object(v) && ['S','M','L'].includes(String(v.size)) && typeof v.price === 'string')) {
                        throw new SalesApiError('Danh mục cần mã UUID PostgreSQL, sản phẩm và giá theo size hợp lệ.');
                    }
                    items.push(p as unknown as SalesProduct);
                }
                if (page >= payload.pagination.totalPages) return items;
            }
            return malformed();
        },
        async branches(): Promise<SalesBranch[]> {
            const items: SalesBranch[] = [];
            for (let page = 1; page <= 10000; page++) {
                const payload = await request(`/branches?page=${page}`);
                if (!object(payload) || !Array.isArray(payload.items) || !integer(payload.total)) return malformed();
                for (const b of payload.items) {
                    if (!object(b) || !uuid(b.id) || typeof b.name !== 'string' || typeof b.isActive !== 'boolean') return malformed();
                    items.push(b as unknown as SalesBranch);
                }
                if (page * 50 >= payload.total) return items;
            }
            return malformed();
        },
    };
}
