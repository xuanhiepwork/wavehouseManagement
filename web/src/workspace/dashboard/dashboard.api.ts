import type { AuthSession } from '../auth';
import { sessionFetch } from '../api';
import type { PaymentChannel, SalesShift, SalesStatus } from '../sales/sales.api';

export type DashboardBranch = { id: string; code: string; name: string; isActive: boolean };
export type StatusCounts = Record<SalesStatus, number> & { total: number };
export type Financials = { grossSales: string; discounts: string; recognizedRefunds: string; netExpected: string; netRecorded: string;
    salesDifference: string; cashDifference: string; beveragesSold: string; approvedReports: number; salesDiscrepancyReports: number; cashDiscrepancyReports: number };
export type InventoryStats = { availableBalances: number; missingBalances: number; zeroStock: number; belowMinimum: number; negativeStock: number };
export type InventoryRow = { branchId: string; ingredientId: string; code: string; name: string; unit: string; isActive: boolean;
    quantity: string | null; minStock: string; updatedAt: string | null; zeroStock: boolean; belowMinimum: boolean; negativeStock: boolean };
export type CountRow = { id: string; branchId: string; businessDate: string; shift: SalesShift; status: SalesStatus; updatedAt: string };
export type ReceivingStats = { postedTransfers: number; confirmed: number; draft: number; awaiting: number;
    legacyUnresolved: number; discrepancyReceipts: number; draftDiscrepancyReceipts: number };
export type DashboardException = { kind: string; branchId: string; referenceId: string; target: 'sales' | 'reconciliation' | 'shift' | 'receiving' | 'inventory'; message: string };
export type DashboardSummary = {
    scope: { mode: 'BRANCH' | 'ALL_BRANCHES'; branchId: string | null; branches: DashboardBranch[]; from: string; to: string;
        timeZone: 'Asia/Ho_Chi_Minh'; maxRangeDays: number }; asOf: string;
    coverage: { statuses: StatusCounts; representedBranchIds: string[]; approvedBranchIds: string[]; coveredDates: string[]; coveredShifts: SalesShift[];
        reportedSlots: { reportId: string; branchId: string; businessDate: string; shift: SalesShift; status: SalesStatus }[];
        scheduleKnown: false; completionPercentage: null };
    kpis: Financials | null;
    salesSeries: { date: string; approvedReports: number; totals: Financials | null }[];
    salesByShift: { shift: SalesShift; totals: Financials | null }[];
    paymentChannels: { channel: PaymentChannel; paymentRecords: number; collectedAmount: string; refundedAmount: string;
        netRecorded: string; platformFee: string; settlementDifference: string }[];
    branchSummaries: { branch: DashboardBranch; coverage: StatusCounts; kpis: Financials | null; inventory: InventoryStats; latestSalesUpdate: string | null }[];
    stockCountSummary: { period: StatusCounts; items: CountRow[]; currentUnresolved: CountRow[]; latestUpdatedAt: string | null;
        scheduleKnown: false; missingRequiredRecords: null; varianceMeaning: 'COUNT_DIFFERENCE_NOT_CONSUMPTION' };
    receivingSummary: {
        period: ReceivingStats & { basis: 'TRANSFER_POSTED_AT'; confirmedDuringPeriod: number; confirmedDuringPeriodWithDiscrepancy: number; damageBasis: 'RECEIPT_CONFIRMED_AT';
            confirmedDamage: { ingredientId: string; code: string; name: string; unit: string; damagedQuantity: string }[] };
        backlog: ReceivingStats & { basis: 'CURRENT_UNCONFIRMED'; asOf: string; undatedTransfers: number; items: { stockDocumentId: string; code: string; branchId: string;
            postedAt: string | null; receiptId: string | null; status: 'DRAFT' | 'AWAITING_RECEIVING'; legacyReceivingRequired: boolean; discrepancyLines: number }[] };
        discrepancies: { stockDocumentId: string; receiptId: string; branchId: string; inSelectedPeriod: boolean; confirmedInSelectedPeriod: boolean; receiptStatus: 'DRAFT' | 'CONFIRMED';
            ingredientId: string; code: string; name: string; unit: string; plannedQuantity: string; receivedQuantity: string; damagedQuantity: string;
            usableQuantity: string; shortageQuantity: string; overageQuantity: string }[]; latestUpdatedAt: string | null };
    inventorySummary: InventoryStats & { basis: 'CURRENT_BALANCES'; asOf: string; activeIngredients: number; latestUpdatedAt: string | null; rows: InventoryRow[] };
    restockPlanning: { available: boolean; mode: 'RULE_BASED'; requiresExplicitParameters: true; endpoint: string | null;
        requiredParameters: string[]; maxDestinationBranches: number; forecast: null };
    exceptions: { total: number; limit: number; truncated: boolean; items: DashboardException[] };
    warnings: { code: string; message: string }[];
};
export type DashboardFilters = { branchId: string; from: string; to: string };
export class DashboardApiError extends Error {
    readonly status: number; readonly code: string;
    constructor(message: string, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const decimal = (v: unknown): v is string => text(v) && /^-?\d+(?:\.\d{1,6})?$/.test(v);
const uuid = (v: unknown): v is string => text(v) && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const nullableDate = (v: unknown) => v === null || (text(v) && Number.isFinite(Date.parse(v)));
const status = (v: unknown) => ['DRAFT','SUBMITTED','RETURNED','APPROVED'].includes(String(v));
const branch = (v: unknown): v is DashboardBranch => object(v) && uuid(v.id) && text(v.code) && text(v.name) && typeof v.isActive === 'boolean';
const statusCounts = (v: unknown) => object(v) && ['total','DRAFT','SUBMITTED','RETURNED','APPROVED'].every(key => integer(v[key]));
const financials = (v: unknown) => v === null || (object(v)
    && ['grossSales','discounts','recognizedRefunds','netExpected','netRecorded','salesDifference','cashDifference','beveragesSold'].every(key => text(v[key]) && /^-?\d+$/.test(v[key] as string))
    && ['approvedReports','salesDiscrepancyReports','cashDiscrepancyReports'].every(key => integer(v[key])));
const inventoryStats = (v: unknown) => object(v) && ['availableBalances','missingBalances','zeroStock','belowMinimum','negativeStock'].every(key => integer(v[key]));
const receivingStats = (v: unknown) => object(v) && ['postedTransfers','confirmed','draft','awaiting','legacyUnresolved','discrepancyReceipts','draftDiscrepancyReceipts'].every(key => integer(v[key]));
const countRow = (v: unknown) => object(v) && uuid(v.id) && uuid(v.branchId) && text(v.businessDate) && text(v.shift) && status(v.status) && nullableDate(v.updatedAt);
const malformed = (): never => { throw new DashboardApiError('Dữ liệu dashboard không đúng định dạng. Vui lòng thử tải lại.'); };
async function request(session: AuthSession, path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await sessionFetch(session, path, { signal });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* Error bodies are sanitized below. */ }
    if (!response.ok) {
        const messages: Record<number, string> = { 400: 'Bộ lọc không hợp lệ. Chọn khoảng ngày tối đa 93 ngày.',
            401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 403: 'Tài khoản không có quyền xem dashboard hoặc chi nhánh này.',
            404: 'Chi nhánh không còn tồn tại hoặc không thuộc phạm vi truy cập.',
            413: 'Phạm vi dữ liệu quá lớn. Hãy chọn một chi nhánh hoặc khoảng ngày ngắn hơn.',
            503: 'Dữ liệu dashboard chưa sẵn sàng. Vui lòng thử lại hoặc liên hệ quản trị.' };
        throw new DashboardApiError(messages[response.status] ?? `Không tải được dữ liệu (HTTP ${response.status}).`, response.status,
            object(payload) && text(payload.code) ? payload.code : '');
    }
    return payload;
}
function parseSummary(raw: unknown): DashboardSummary {
    if (!object(raw) || !object(raw.data)) return malformed();
    const d = raw.data;
    if (!object(d.scope) || !Array.isArray(d.scope.branches) || !d.scope.branches.every(branch) || !text(d.scope.from) || !text(d.scope.to)
        || !['BRANCH','ALL_BRANCHES'].includes(String(d.scope.mode)) || !(d.scope.branchId === null || uuid(d.scope.branchId))
        || d.scope.timeZone !== 'Asia/Ho_Chi_Minh' || !integer(d.scope.maxRangeDays)
        || !text(d.asOf) || !nullableDate(d.asOf) || !object(d.coverage) || !statusCounts(d.coverage.statuses)
        || !Array.isArray(d.coverage.reportedSlots) || !d.coverage.reportedSlots.every(r => object(r) && uuid(r.reportId) && uuid(r.branchId) && text(r.businessDate) && text(r.shift) && status(r.status))
        || !['representedBranchIds','approvedBranchIds','coveredDates','coveredShifts'].every(key => {
            const values = (d.coverage as Record<string, unknown>)[key];
            return Array.isArray(values) && values.every(text);
        })
        || !financials(d.kpis) || !Array.isArray(d.salesSeries) || !d.salesSeries.every(r => object(r) && text(r.date) && integer(r.approvedReports) && financials(r.totals))
        || !Array.isArray(d.salesByShift) || !d.salesByShift.every(r => object(r) && text(r.shift) && financials(r.totals))
        || !Array.isArray(d.paymentChannels) || !d.paymentChannels.every(p => object(p) && text(p.channel)
            && ['CASH','BANK_TRANSFER','MOMO','GRAB','OTHER'].includes(p.channel) && integer(p.paymentRecords)
            && ['collectedAmount','refundedAmount','netRecorded','platformFee','settlementDifference'].every(key => decimal(p[key])))
        || !Array.isArray(d.branchSummaries) || !d.branchSummaries.every(b => object(b) && branch(b.branch) && statusCounts(b.coverage)
            && financials(b.kpis) && inventoryStats(b.inventory) && nullableDate(b.latestSalesUpdate))
        || !object(d.stockCountSummary) || !statusCounts(d.stockCountSummary.period) || !Array.isArray(d.stockCountSummary.items) || !d.stockCountSummary.items.every(countRow)
        || !Array.isArray(d.stockCountSummary.currentUnresolved) || !d.stockCountSummary.currentUnresolved.every(countRow)
        || !nullableDate(d.stockCountSummary.latestUpdatedAt)
        || !object(d.inventorySummary) || !inventoryStats(d.inventorySummary) || !Array.isArray(d.inventorySummary.rows)
        || !text(d.inventorySummary.asOf) || !nullableDate(d.inventorySummary.asOf) || !nullableDate(d.inventorySummary.latestUpdatedAt)
        || !d.inventorySummary.rows.every(r => object(r) && uuid(r.branchId) && uuid(r.ingredientId) && text(r.code) && text(r.name) && text(r.unit)
            && (r.quantity === null || decimal(r.quantity)) && decimal(r.minStock) && nullableDate(r.updatedAt)
            && ['isActive','zeroStock','belowMinimum','negativeStock'].every(key => typeof r[key] === 'boolean'))
        || !object(d.receivingSummary) || !object(d.receivingSummary.period) || !receivingStats(d.receivingSummary.period)
        || !integer(d.receivingSummary.period.confirmedDuringPeriod) || !integer(d.receivingSummary.period.confirmedDuringPeriodWithDiscrepancy)
        || !Array.isArray(d.receivingSummary.period.confirmedDamage) || !d.receivingSummary.period.confirmedDamage.every(r => object(r) && uuid(r.ingredientId) && text(r.name) && text(r.code) && text(r.unit) && decimal(r.damagedQuantity))
        || !object(d.receivingSummary.backlog) || !receivingStats(d.receivingSummary.backlog) || !integer(d.receivingSummary.backlog.undatedTransfers) || !Array.isArray(d.receivingSummary.backlog.items)
        || !d.receivingSummary.backlog.items.every(r => object(r) && uuid(r.stockDocumentId) && uuid(r.branchId) && text(r.code) && text(r.status)
            && nullableDate(r.postedAt) && typeof r.legacyReceivingRequired === 'boolean' && integer(r.discrepancyLines))
        || !Array.isArray(d.receivingSummary.discrepancies) || !d.receivingSummary.discrepancies.every(r => object(r) && uuid(r.branchId) && uuid(r.receiptId)
            && uuid(r.stockDocumentId) && uuid(r.ingredientId) && text(r.code) && text(r.name) && text(r.unit) && text(r.receiptStatus)
            && typeof r.inSelectedPeriod === 'boolean' && typeof r.confirmedInSelectedPeriod === 'boolean'
            && ['plannedQuantity','receivedQuantity','damagedQuantity','usableQuantity','shortageQuantity','overageQuantity'].every(key => decimal(r[key])))
        || !nullableDate(d.receivingSummary.latestUpdatedAt)
        || !object(d.restockPlanning) || typeof d.restockPlanning.available !== 'boolean' || d.restockPlanning.mode !== 'RULE_BASED'
        || !object(d.exceptions) || !integer(d.exceptions.total) || !integer(d.exceptions.limit) || typeof d.exceptions.truncated !== 'boolean' || !Array.isArray(d.exceptions.items)
        || !d.exceptions.items.every(e => object(e) && uuid(e.branchId) && text(e.referenceId) && text(e.kind) && text(e.message) && ['sales','reconciliation','shift','receiving','inventory'].includes(String(e.target)))
        || !Array.isArray(d.warnings) || !d.warnings.every(w => object(w) && text(w.code) && text(w.message))) return malformed();
    return d as unknown as DashboardSummary;
}
export async function loadDashboardSummary(session: AuthSession, filters: DashboardFilters, signal?: AbortSignal): Promise<DashboardSummary> {
    if (session.user.role === 'STAFF') throw new DashboardApiError('Chỉ quản lý được xem dashboard.', 403);
    const branchId = filters.branchId;
    const query = new URLSearchParams({ from: filters.from, to: filters.to });
    if (branchId) query.set('branchId', branchId);
    const data = parseSummary(await request(session, `/dashboard/summary?${query}`, signal));
    if (data.scope.from !== filters.from || data.scope.to !== filters.to || (data.scope.branchId ?? '') !== branchId) return malformed();
    const allowed = new Set(data.scope.branches.map(b => b.id));
    if (branchId && data.scope.branches.some(b => b.id !== branchId)) return malformed();
    if ([...data.coverage.representedBranchIds, ...data.coverage.approvedBranchIds].some(id => !allowed.has(id))) return malformed();
    if ([...data.inventorySummary.rows, ...data.coverage.reportedSlots, ...data.stockCountSummary.items, ...data.stockCountSummary.currentUnresolved,
        ...data.receivingSummary.backlog.items, ...data.receivingSummary.discrepancies, ...data.exceptions.items].some(row => !allowed.has(row.branchId))
        || data.branchSummaries.some(row => !allowed.has(row.branch.id))) return malformed();
    return data;
}
export async function loadDashboardBranches(session: AuthSession, signal?: AbortSignal): Promise<DashboardBranch[]> {
    if (session.user.role === 'STAFF') throw new DashboardApiError('Chỉ quản lý được xem dashboard.', 403);
    if (session.user.role === 'BRANCH_MANAGER') {
        if (!session.user.areaId) throw new DashboardApiError('Quản lý chưa được phân công khu vực.', 403);
        const payload = await request(session, `/areas/${encodeURIComponent(session.user.areaId)}/branches`, signal);
        if (!object(payload) || !Array.isArray(payload.items) || !payload.items.every(branch)) return malformed();
        return payload.items as DashboardBranch[];
    }
    const result: DashboardBranch[] = [];
    for (let page = 1; page <= 20; page++) {
        const payload = await request(session, `/branches?page=${page}`, signal);
        if (!object(payload) || !Array.isArray(payload.items) || !payload.items.every(branch) || !integer(payload.total)) return malformed();
        if ((payload.total as number) > 1000) throw new DashboardApiError('Danh sách vượt 1000 chi nhánh, cần bổ sung tìm kiếm chi nhánh phía server.', 413);
        result.push(...payload.items);
        if (page * 50 >= (payload.total as number)) return result;
    }
    return malformed();
}
