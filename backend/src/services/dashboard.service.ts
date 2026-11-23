import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, UUID_RE } from '../utils/admin-api';
import { salesChannels, type SalesActor } from './sales-report.service';

type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
type Status = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
type StatusCounts = Record<Status, number> & { total: number };
const SHIFTS: Shift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const DAY = 86400000;
// Local Decimal constructor: dashboard sums must not change W7.3/B7 precision globally.
const Exact = Prisma.Decimal.clone({ precision: 60 });
const exact = (value: Prisma.Decimal | string | number) => new Exact(value.toString());
const limits = { branches: 100, salesReports: 10000, counts: 10000, transfers: 5000,
    receiptLines: 25000, activeIngredients: 2000, inventoryRows: 20000, exceptions: 100 } as const;
export class DashboardError extends Error {
    constructor(message: string, public readonly status = 400, public readonly code = 'INVALID_DASHBOARD_QUERY') { super(message); }
}
const integrity = (): never => { throw new DashboardError('Dashboard source data is inconsistent', 503, 'DASHBOARD_INTEGRITY_ERROR'); };
function bounded(count: number, max: number) {
    if (count > max) throw new DashboardError('Dashboard scope is too large. Select one branch or a shorter date range.', 413, 'DASHBOARD_SCOPE_TOO_LARGE');
}
function date(value: unknown): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') throw new DashboardError('Invalid date');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new DashboardError('Invalid date');
    return parsed;
}
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
export type DashboardQuery = { branchId?: string; from: Date; to: Date };
export function parseDashboardQuery(raw: Record<string, unknown>, now = new Date()): DashboardQuery {
    if (!onlyKeys(raw, ['branchId', 'from', 'to'])) throw new DashboardError('Invalid query parameters');
    const query: DashboardQuery = { from: new Date(0), to: new Date(0) };
    if (raw.branchId !== undefined) {
        if (typeof raw.branchId !== 'string' || !UUID_RE.test(raw.branchId)) throw new DashboardError('Invalid branch ID');
        query.branchId = raw.branchId.toLowerCase();
    }
    if (raw.from === undefined && raw.to === undefined) {
        // Vietnam calendar date, independent of the server host's timezone.
        const today = new Date(now.getTime() + 7 * 3600000);
        query.to = date(dateKey(today)); query.from = new Date(query.to.getTime() - 13 * DAY);
    } else {
        query.from = date(raw.from); query.to = date(raw.to);
    }
    if (query.to < query.from || (query.to.getTime() - query.from.getTime()) / DAY + 1 > 93) {
        throw new DashboardError('Date range must contain 1–93 inclusive days');
    }
    return query;
}
const counts = (): StatusCounts => ({ total: 0, DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0 });
function addStatus(target: StatusCounts, status: Status) { target.total++; target[status]++; }
const financialKeys = ['grossSales', 'discounts', 'recognizedRefunds', 'netExpected', 'netRecorded', 'salesDifference', 'cashDifference', 'beveragesSold'] as const;
type FinancialKey = typeof financialKeys[number];
export type DashboardFinancials = Record<FinancialKey, string> & { approvedReports: number; salesDiscrepancyReports: number; cashDiscrepancyReports: number };
type FinancialAccumulator = { amounts: Record<FinancialKey, Prisma.Decimal>; approvedReports: number; salesDiscrepancyReports: number; cashDiscrepancyReports: number };
function accumulator(): FinancialAccumulator {
    return { amounts: Object.fromEntries(financialKeys.map(key => [key, exact(0)])) as Record<FinancialKey, Prisma.Decimal>,
        approvedReports: 0, salesDiscrepancyReports: 0, cashDiscrepancyReports: 0 };
}
function serializeTotals(value: FinancialAccumulator): DashboardFinancials | null {
    if (!value.approvedReports) return null;
    return { ...Object.fromEntries(financialKeys.map(key => [key, value.amounts[key].toFixed(0)])) as Record<FinancialKey, string>,
        approvedReports: value.approvedReports, salesDiscrepancyReports: value.salesDiscrepancyReports, cashDiscrepancyReports: value.cashDiscrepancyReports };
}
const branchSelect = { id: true, code: true, name: true, isActive: true } as const;
const reportSelect = { id: true, branchId: true, businessDate: true, shift: true, status: true,
    currentRevisionNumber: true, approvedRevisionNumber: true, submittedRevisionNumber: true, approvedAt: true, updatedAt: true } as const;
const revisionSelect = { id: true, reportId: true, number: true, grossSales: true, discounts: true, recognizedRefunds: true,
    netExpected: true, netRecorded: true, salesDifference: true, cashDifference: true,
    payments: { select: { channel: true, collectedAmount: true, refundedAmount: true, platformFee: true, settlementDifference: true } } } as const;
type Revision = Prisma.SalesReportRevisionGetPayload<{ select: typeof revisionSelect }>;
function addFinancials(target: FinancialAccumulator, revision: Revision, beverages: number) {
    if (revision.cashDifference === null) return integrity();
    for (const key of financialKeys) {
        const value = exact(key === 'beveragesSold' ? beverages : revision[key]!);
        if (!value.isFinite() || !value.isInteger()) return integrity();
        target.amounts[key] = target.amounts[key].plus(value);
    }
    target.approvedReports++;
    if (!revision.salesDifference.isZero()) target.salesDiscrepancyReports++;
    if (!revision.cashDifference.isZero()) target.cashDiscrepancyReports++;
}
type Exception = { kind: string; branchId: string; referenceId: string; target: 'sales' | 'reconciliation' | 'shift' | 'receiving' | 'inventory'; message: string };
const latest = (dates: (Date | null)[]): string | null => {
    let result: Date | null = null;
    for (const value of dates) if (value && (!result || value > result)) result = value;
    return result?.toISOString() ?? null;
};

export function createDashboardService(db: PrismaClient) {
    return {
        async summary(actor: SalesActor, query: DashboardQuery) {
            if (!['ADMIN', 'BRANCH_MANAGER'].includes(actor.role) || (actor.role === 'BRANCH_MANAGER' && !actor.branchId)) {
                throw new DashboardError('Management access required', 403, 'FORBIDDEN');
            }
            if (actor.role === 'BRANCH_MANAGER' && query.branchId && query.branchId !== actor.branchId) {
                // Reject before checking existence, so no foreign-branch metadata is disclosed.
                throw new DashboardError('Forbidden branch', 403, 'FORBIDDEN');
            }
            const branchId = actor.role === 'ADMIN' ? query.branchId : actor.branchId!;
            return db.$transaction(async tx => {
                await tx.$executeRaw`SET TRANSACTION READ ONLY`;
                const clock = await tx.$queryRaw<{ asOf: Date }[]>`SELECT transaction_timestamp() AS "asOf"`;
                const asOf = clock[0]?.asOf.toISOString();
                if (!asOf) return integrity();
                const branches = await tx.branch.findMany({ where: branchId ? { id: branchId } : {}, select: branchSelect,
                    orderBy: [{ code: 'asc' }, { id: 'asc' }], take: limits.branches + 1 });
                bounded(branches.length, limits.branches);
                if (branchId && !branches.length) throw new DashboardError('Branch not found', 404, 'DASHBOARD_BRANCH_NOT_FOUND');
                const branchIds = branches.map(b => b.id);
                const from = dateKey(query.from); const to = dateKey(query.to);
                const businessDate = { gte: query.from, lte: query.to };
                const postedWindow = { gte: new Date(query.from.getTime() - 7 * 3600000), lt: new Date(query.to.getTime() + DAY - 7 * 3600000) };
                const reports = await tx.salesReport.findMany({ where: { branchId: { in: branchIds }, businessDate }, select: reportSelect,
                    orderBy: [{ businessDate: 'asc' }, { branchId: 'asc' }, { shift: 'asc' }], take: limits.salesReports + 1 });
                bounded(reports.length, limits.salesReports);
                const approved = reports.filter(r => r.status === 'APPROVED');
                for (const report of approved) {
                    if (!report.approvedAt || report.approvedRevisionNumber === null || report.approvedRevisionNumber !== report.currentRevisionNumber
                        || report.approvedRevisionNumber !== report.submittedRevisionNumber) return integrity();
                }
                const revisions: Revision[] = [];
                // Load precisely one approved revision per report, never all revision histories.
                for (let offset = 0; offset < approved.length; offset += 500) {
                    revisions.push(...await tx.salesReportRevision.findMany({ where: { OR: approved.slice(offset, offset + 500)
                        .map(r => ({ reportId: r.id, number: r.approvedRevisionNumber! })) }, select: revisionSelect }));
                }
                if (revisions.length !== approved.length) return integrity();
                const revisionMap = new Map(revisions.map(r => [r.reportId, r]));
                const beverages = new Map<string, number>();
                for (let offset = 0; offset < revisions.length; offset += 500) {
                    const groups = await tx.salesReportLine.groupBy({ by: ['revisionId'], where: { revisionId: { in: revisions.slice(offset, offset + 500).map(r => r.id) } }, _sum: { quantity: true } });
                    for (const group of groups) {
                        const quantity = group._sum.quantity ?? 0;
                        if (!Number.isSafeInteger(quantity) || quantity < 0) return integrity();
                        beverages.set(group.revisionId, quantity);
                    }
                }
                const coverageCounts = counts();
                const branchCounts = new Map(branchIds.map(id => [id, counts()]));
                const totalFinance = accumulator();
                const branchFinance = new Map(branchIds.map(id => [id, accumulator()]));
                const shiftFinance = new Map(SHIFTS.map(shift => [shift, accumulator()]));
                const daily = new Map<string, FinancialAccumulator>();
                for (let day = query.from.getTime(); day <= query.to.getTime(); day += DAY) daily.set(dateKey(new Date(day)), accumulator());
                const paymentTotals = new Map(salesChannels.map(channel => [channel, { paymentRecords: 0, collectedAmount: exact(0), refundedAmount: exact(0),
                    netRecorded: exact(0), platformFee: exact(0), settlementDifference: exact(0) }]));
                const exceptions: Exception[] = [];
                for (const report of reports) {
                    addStatus(coverageCounts, report.status); addStatus(branchCounts.get(report.branchId)!, report.status);
                    if (report.status === 'SUBMITTED' || report.status === 'RETURNED') exceptions.push({ kind: `SALES_${report.status}`, branchId: report.branchId,
                        referenceId: report.id, target: report.status === 'SUBMITTED' ? 'reconciliation' : 'sales',
                        message: report.status === 'SUBMITTED' ? 'Báo cáo doanh thu đang chờ xét duyệt.' : 'Báo cáo doanh thu đã trả lại, cần bổ sung.' });
                    if (report.status !== 'APPROVED') continue;
                    const revision = revisionMap.get(report.id);
                    if (!revision || revision.number !== report.approvedRevisionNumber) return integrity();
                    const quantity = beverages.get(revision.id) ?? 0;
                    for (const bucket of [totalFinance, branchFinance.get(report.branchId)!, shiftFinance.get(report.shift)!, daily.get(dateKey(report.businessDate))!]) {
                        addFinancials(bucket, revision, quantity);
                    }
                    if (!revision.salesDifference.isZero() || !revision.cashDifference!.isZero()) exceptions.push({ kind: 'FINANCIAL_DIFFERENCE', branchId: report.branchId,
                        referenceId: report.id, target: 'reconciliation', message: 'Báo cáo đã duyệt có chênh lệch doanh thu hoặc tiền mặt; cần đối chiếu chứng từ.' });
                    for (const p of revision.payments) {
                        const bucket = paymentTotals.get(p.channel)!;
                        bucket.paymentRecords++;
                        bucket.collectedAmount = bucket.collectedAmount.plus(p.collectedAmount.toString());
                        bucket.refundedAmount = bucket.refundedAmount.plus(p.refundedAmount.toString());
                        bucket.netRecorded = bucket.netRecorded.plus(exact(p.collectedAmount).minus(p.refundedAmount.toString()));
                        bucket.platformFee = bucket.platformFee.plus(p.platformFee.toString());
                        bucket.settlementDifference = bucket.settlementDifference.plus(p.settlementDifference.toString());
                    }
                }

                const stockCounts = await tx.shiftStockCount.findMany({ where: { branchId: { in: branchIds }, OR: [
                    { businessDate }, { status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } },
                ] }, select: { id: true, branchId: true, businessDate: true, shift: true, status: true, updatedAt: true },
                    orderBy: [{ businessDate: 'desc' }, { id: 'asc' }], take: limits.counts + 1 });
                bounded(stockCounts.length, limits.counts);
                const periodCounts = stockCounts.filter(r => r.businessDate >= query.from && r.businessDate <= query.to);
                const countStatuses = counts(); for (const row of periodCounts) addStatus(countStatuses, row.status);
                const unresolvedCounts = stockCounts.filter(r => r.status !== 'APPROVED');
                for (const row of unresolvedCounts) if (row.status === 'SUBMITTED' || row.status === 'RETURNED') exceptions.push({ kind: `COUNT_${row.status}`,
                    branchId: row.branchId, referenceId: row.id, target: 'shift', message: row.status === 'SUBMITTED' ? 'Phiếu kiểm kê đang chờ quản lý duyệt.' : 'Phiếu kiểm kê đã trả lại, cần sửa.' });
                const countDto = (r: typeof stockCounts[number]) => ({ ...r, businessDate: dateKey(r.businessDate), updatedAt: r.updatedAt.toISOString() });

                const activeIngredients = await tx.ingredient.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, unit: true, minStock: true, isActive: true },
                    orderBy: { code: 'asc' }, take: limits.activeIngredients + 1 });
                bounded(activeIngredients.length, limits.activeIngredients);
                bounded(branches.length * activeIngredients.length, limits.inventoryRows);
                const balances = await tx.inventoryBalance.findMany({ where: { branchId: { in: branchIds } },
                    select: { branchId: true, ingredientId: true, quantity: true, updatedAt: true,
                        ingredient: { select: { id: true, code: true, name: true, unit: true, minStock: true, isActive: true } } },
                    orderBy: [{ branchId: 'asc' }, { ingredientId: 'asc' }], take: limits.inventoryRows + 1 });
                bounded(balances.length, limits.inventoryRows);
                type InventoryRow = { branchId: string; ingredientId: string; code: string; name: string; unit: string; isActive: boolean;
                    quantity: string | null; minStock: string; updatedAt: string | null; zeroStock: boolean; belowMinimum: boolean; negativeStock: boolean };
                const inventoryRows: InventoryRow[] = balances.map(b => ({ branchId: b.branchId, ingredientId: b.ingredientId,
                    code: b.ingredient.code, name: b.ingredient.name, unit: b.ingredient.unit, isActive: b.ingredient.isActive,
                    quantity: b.quantity.toFixed(6), minStock: b.ingredient.minStock.toFixed(6), updatedAt: b.updatedAt.toISOString(),
                    zeroStock: b.quantity.isZero(), belowMinimum: b.quantity.lt(b.ingredient.minStock), negativeStock: b.quantity.isNegative() }));
                const balanceKeys = new Set(balances.map(b => `${b.branchId}:${b.ingredientId}`));
                for (const branch of branches) for (const ingredient of activeIngredients) if (!balanceKeys.has(`${branch.id}:${ingredient.id}`)) {
                    inventoryRows.push({ branchId: branch.id, ingredientId: ingredient.id, code: ingredient.code, name: ingredient.name,
                        unit: ingredient.unit, isActive: true, quantity: null, minStock: ingredient.minStock.toFixed(6), updatedAt: null,
                        zeroStock: false, belowMinimum: false, negativeStock: false });
                }
                bounded(inventoryRows.length, limits.inventoryRows);
                const inventoryStats = (rows: InventoryRow[]) => ({ availableBalances: rows.filter(r => r.quantity !== null).length,
                    missingBalances: rows.filter(r => r.quantity === null).length, zeroStock: rows.filter(r => r.zeroStock).length,
                    belowMinimum: rows.filter(r => r.belowMinimum).length, negativeStock: rows.filter(r => r.negativeStock).length });
                for (const branch of branches) {
                    const rows = inventoryRows.filter(r => r.branchId === branch.id); const stats = inventoryStats(rows);
                    for (const [kind, total, message] of [
                        ['INVENTORY_MISSING', stats.missingBalances, 'nguyên liệu đang hoạt động chưa có bản ghi số dư; chưa xác định tồn'],
                        ['INVENTORY_ZERO', stats.zeroStock, 'bản ghi tồn bằng 0'], ['INVENTORY_LOW', stats.belowMinimum, 'bản ghi tồn dưới mức tối thiểu'],
                        ['INVENTORY_NEGATIVE', stats.negativeStock, 'bản ghi tồn âm cần kiểm tra'],
                    ] as const) if (total) exceptions.push({ kind, branchId: branch.id, referenceId: branch.id, target: 'inventory', message: `${total} ${message}.` });
                }

                const transferWhere: Prisma.StockDocumentWhereInput = { type: 'TRANSFER', status: 'POSTED', destinationBranchId: { in: branchIds },
                    OR: [{ postedAt: postedWindow }, { postedAt: null }, { transferReceipt: { is: null } }, { transferReceipt: { is: { status: 'DRAFT' } } },
                        { transferReceipt: { is: { status: 'CONFIRMED', confirmedAt: postedWindow } } }] };
                bounded(await tx.stockDocument.count({ where: transferWhere }), limits.transfers);
                bounded(await tx.transferReceiptItem.count({ where: { receipt: { stockDocument: transferWhere } } }), limits.receiptLines);
                const transfers = await tx.stockDocument.findMany({ where: transferWhere, select: {
                    id: true, code: true, destinationBranchId: true, postedAt: true, updatedAt: true, legacyReceivingRequired: true,
                    transferReceipt: { select: { id: true, status: true, updatedAt: true, confirmedAt: true, items: true } },
                }, orderBy: [{ postedAt: 'asc' }, { id: 'asc' }] });
                const inPeriod = (r: typeof transfers[number]) => !!r.postedAt && r.postedAt >= postedWindow.gte && r.postedAt < postedWindow.lt;
                const confirmedInPeriod = (r: typeof transfers[number]) => r.transferReceipt?.status === 'CONFIRMED'
                    && !!r.transferReceipt.confirmedAt && r.transferReceipt.confirmedAt >= postedWindow.gte && r.transferReceipt.confirmedAt < postedWindow.lt;
                const periodTransfers = transfers.filter(inPeriod);
                const periodConfirmations = transfers.filter(confirmedInPeriod);
                const unresolvedTransfers = transfers.filter(r => r.transferReceipt?.status !== 'CONFIRMED');
                const discrepancies = [];
                const damage = new Map<string, { ingredientId: string; code: string; name: string; unit: string; damagedQuantity: Prisma.Decimal }>();
                const discrepancyCount = new Map<string, number>();
                for (const transfer of transfers) {
                    const receipt = transfer.transferReceipt;
                    if (!receipt) continue;
                    for (const item of receipt.items) {
                        const delta = exact(item.receivedQuantity).minus(item.plannedQuantity.toString());
                        if (!delta.isZero() || !item.damagedQuantity.isZero()) {
                            discrepancyCount.set(transfer.id, (discrepancyCount.get(transfer.id) ?? 0) + 1);
                            discrepancies.push({ stockDocumentId: transfer.id, receiptId: receipt.id, branchId: transfer.destinationBranchId!,
                                inSelectedPeriod: inPeriod(transfer), confirmedInSelectedPeriod: confirmedInPeriod(transfer), receiptStatus: receipt.status, ingredientId: item.ingredientId,
                                code: item.ingredientCode, name: item.ingredientName, unit: item.unit,
                                plannedQuantity: item.plannedQuantity.toFixed(6), receivedQuantity: item.receivedQuantity.toFixed(6),
                                damagedQuantity: item.damagedQuantity.toFixed(6), usableQuantity: exact(item.receivedQuantity).minus(item.damagedQuantity.toString()).toFixed(6),
                                shortageQuantity: delta.isNegative() ? delta.negated().toFixed(6) : '0.000000', overageQuantity: delta.isPositive() ? delta.toFixed(6) : '0.000000' });
                        }
                        if (confirmedInPeriod(transfer) && item.damagedQuantity.gt(0)) {
                            const key = `${item.ingredientId}:${item.unit}`;
                            const row = damage.get(key) ?? { ingredientId: item.ingredientId, code: item.ingredientCode,
                                name: item.ingredientName, unit: item.unit, damagedQuantity: exact(0) };
                            row.damagedQuantity = row.damagedQuantity.plus(item.damagedQuantity.toString()); damage.set(key, row);
                        }
                    }
                }
                for (const transfer of unresolvedTransfers) exceptions.push({ kind: transfer.legacyReceivingRequired ? 'LEGACY_RECEIVING_UNRESOLVED' : 'RECEIVING_PENDING',
                    branchId: transfer.destinationBranchId!, referenceId: transfer.id, target: 'receiving',
                    message: transfer.legacyReceivingRequired ? 'Phiếu chuyển lịch sử chưa xác nhận nhận thực tế.' : 'Phiếu chuyển đã ghi sổ, đang chờ xác nhận nhận thực tế.' });
                for (const transfer of transfers) if (discrepancyCount.has(transfer.id)) exceptions.push({ kind: 'RECEIVING_DISCREPANCY', branchId: transfer.destinationBranchId!,
                    referenceId: transfer.id, target: 'receiving', message: transfer.transferReceipt?.status === 'CONFIRMED' ? 'Biên bản nhận đã xác nhận có chênh lệch/hư hỏng.' : 'Bản nháp nhận hàng đang ghi chênh lệch/hư hỏng, chưa xác nhận.' });
                const receivingStats = (rows: typeof transfers) => ({ postedTransfers: rows.length,
                    confirmed: rows.filter(r => r.transferReceipt?.status === 'CONFIRMED').length,
                    draft: rows.filter(r => r.transferReceipt?.status === 'DRAFT').length,
                    awaiting: rows.filter(r => !r.transferReceipt).length,
                    legacyUnresolved: rows.filter(r => r.legacyReceivingRequired && r.transferReceipt?.status !== 'CONFIRMED').length,
                    discrepancyReceipts: rows.filter(r => r.transferReceipt?.status === 'CONFIRMED' && discrepancyCount.has(r.id)).length,
                    draftDiscrepancyReceipts: rows.filter(r => r.transferReceipt?.status === 'DRAFT' && discrepancyCount.has(r.id)).length });

                const warnings = [
                    { code: 'NO_SHIFT_SCHEDULE', message: 'Chưa có lịch ca chuẩn để xác định số báo cáo/phiếu kiểm kê bắt buộc còn thiếu hoặc tỷ lệ hoàn thành.' },
                    { code: 'CURRENT_OPERATIONS', message: 'Tồn kho và danh sách chưa xử lý là trạng thái hiện tại; không phải số dư cuối kỳ của khoảng ngày đã chọn.' },
                    { code: 'VARIANCE_NOT_CONSUMPTION', message: 'Chênh lệch kiểm kê B6 không phải lượng nguyên liệu tiêu thụ thực tế. Chênh lệch tiền không phải kết luận vi phạm.' },
                ];
                if (!approved.length) warnings.push({ code: 'NO_APPROVED_SALES', message: 'Chưa có báo cáo doanh thu đã duyệt trong phạm vi. Chưa đủ dữ liệu kết luận doanh thu hoặc hiệu suất bằng 0.' });
                if (reports.length > approved.length) warnings.push({ code: 'UNAPPROVED_SALES_EXCLUDED', message: `${reports.length - approved.length} báo cáo chưa duyệt không được tính vào KPI tài chính.` });
                const inventory = inventoryStats(inventoryRows);
                if (inventory.missingBalances) warnings.push({ code: 'MISSING_INVENTORY_BALANCES', message: `${inventory.missingBalances} cặp chi nhánh/nguyên liệu đang hoạt động chưa có số dư; không quy đổi thành tồn 0.` });
                if (transfers.some(t => !t.postedAt)) warnings.push({ code: 'TRANSFER_POSTED_DATE_MISSING', message: 'Có phiếu đã ghi sổ thiếu ngày ghi sổ; không thể xếp vào thống kê nhận hàng theo kỳ.' });
                if (branches.some(b => !b.isActive)) warnings.push({ code: 'INACTIVE_BRANCHES_INCLUDED', message: 'Phạm vi có chi nhánh ngừng hoạt động; lịch sử đã duyệt vẫn được tính và trạng thái hiện tại được ghi riêng.' });
                return {
                    scope: { mode: branchId ? 'BRANCH' as const : 'ALL_BRANCHES' as const, branchId: branchId ?? null,
                        branches, from, to, timeZone: 'Asia/Ho_Chi_Minh' as const, maxRangeDays: 93 }, asOf,
                    coverage: { statuses: coverageCounts, representedBranchIds: [...new Set(reports.map(r => r.branchId))], approvedBranchIds: [...new Set(approved.map(r => r.branchId))],
                        coveredDates: [...new Set(reports.map(r => dateKey(r.businessDate)))], coveredShifts: SHIFTS.filter(shift => reports.some(r => r.shift === shift)),
                        reportedSlots: reports.map(r => ({ reportId: r.id, branchId: r.branchId, businessDate: dateKey(r.businessDate), shift: r.shift, status: r.status })),
                        scheduleKnown: false as const, completionPercentage: null },
                    kpis: serializeTotals(totalFinance),
                    salesSeries: [...daily].map(([day, bucket]) => ({ date: day, approvedReports: bucket.approvedReports, totals: serializeTotals(bucket) })),
                    salesByShift: SHIFTS.map(shift => ({ shift, totals: serializeTotals(shiftFinance.get(shift)!) })),
                    paymentChannels: approved.length ? [...paymentTotals].map(([channel, p]) => ({ channel, paymentRecords: p.paymentRecords,
                        collectedAmount: p.collectedAmount.toFixed(0), refundedAmount: p.refundedAmount.toFixed(0), netRecorded: p.netRecorded.toFixed(0),
                        platformFee: p.platformFee.toFixed(0), settlementDifference: p.settlementDifference.toFixed(0) })) : [],
                    branchSummaries: branches.map(branch => ({ branch, coverage: branchCounts.get(branch.id)!, kpis: serializeTotals(branchFinance.get(branch.id)!),
                        inventory: inventoryStats(inventoryRows.filter(r => r.branchId === branch.id)),
                        latestSalesUpdate: latest(reports.filter(r => r.branchId === branch.id).map(r => r.updatedAt)) })),
                    stockCountSummary: { period: countStatuses, items: periodCounts.map(countDto), currentUnresolved: unresolvedCounts.map(countDto),
                        latestUpdatedAt: latest(stockCounts.map(r => r.updatedAt)), scheduleKnown: false as const, missingRequiredRecords: null,
                        varianceMeaning: 'COUNT_DIFFERENCE_NOT_CONSUMPTION' as const },
                    receivingSummary: { period: { basis: 'TRANSFER_POSTED_AT' as const, ...receivingStats(periodTransfers),
                        confirmedDuringPeriod: periodConfirmations.length,
                        confirmedDuringPeriodWithDiscrepancy: periodConfirmations.filter(r => discrepancyCount.has(r.id)).length,
                        damageBasis: 'RECEIPT_CONFIRMED_AT' as const,
                        confirmedDamage: [...damage.values()].map(r => ({ ...r, damagedQuantity: r.damagedQuantity.toFixed(6) })) },
                        backlog: { basis: 'CURRENT_UNCONFIRMED' as const, asOf, ...receivingStats(unresolvedTransfers),
                            undatedTransfers: unresolvedTransfers.filter(r => !r.postedAt).length,
                            items: unresolvedTransfers.map(r => ({ stockDocumentId: r.id, code: r.code, branchId: r.destinationBranchId!,
                                postedAt: r.postedAt?.toISOString() ?? null, receiptId: r.transferReceipt?.id ?? null,
                                status: r.transferReceipt?.status === 'DRAFT' ? 'DRAFT' as const : 'AWAITING_RECEIVING' as const,
                                legacyReceivingRequired: r.legacyReceivingRequired, discrepancyLines: discrepancyCount.get(r.id) ?? 0 })) },
                        discrepancies, latestUpdatedAt: latest(transfers.flatMap(r => [r.updatedAt, r.transferReceipt?.updatedAt ?? null])) },
                    inventorySummary: { basis: 'CURRENT_BALANCES' as const, asOf, ...inventory, activeIngredients: activeIngredients.length,
                        latestUpdatedAt: latest(balances.map(r => r.updatedAt)), rows: inventoryRows },
                    restockPlanning: { available: actor.role === 'ADMIN', mode: 'RULE_BASED' as const, requiresExplicitParameters: true as const,
                        endpoint: actor.role === 'ADMIN' ? '/api/restock-planning/recommendations' : null,
                        requiredParameters: actor.role === 'ADMIN' ? ['businessDate', 'shift', 'sourceBranchId', 'destinationBranchIds'] : [],
                        maxDestinationBranches: 10, forecast: null },
                    exceptions: { total: exceptions.length, limit: limits.exceptions, truncated: exceptions.length > limits.exceptions, items: exceptions.slice(0, limits.exceptions) },
                    warnings,
                };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 30000 });
        },
    };
}
