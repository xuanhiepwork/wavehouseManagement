import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, readBody, UUID_RE } from '../utils/admin-api';

export type SalesActor = { id: string; role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF'; branchId: string | null };
export class SalesReportError extends Error {
    constructor(message: string, public readonly status = 400, public readonly code = 'INVALID_SALES_REPORT') { super(message); }
}
const invalid = (message: string): never => { throw new SalesReportError(message); };
const conflict = (message = 'Report changed. Reload before retrying.'): never => {
    throw new SalesReportError(message, 409, 'SALES_REPORT_CONFLICT');
};
export const salesChannels = ['CASH', 'BANK_TRANSFER', 'MOMO', 'GRAB', 'OTHER'] as const;
type Channel = typeof salesChannels[number];
type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
type LineInput = { productId: string | null; productName: string; size: string; quantity: number; unitPrice: string; note: string | null };
type PaymentInput = { channel: Channel; collectedAmount: string; refundedAmount: string; platformFee: string; settlementDifference: string; note: string | null };
export type SalesInput = {
    branchId: string; businessDate: Date; shift: Shift; note: string | null; discounts: string;
    lines: LineInput[]; payments: PaymentInput[];
    expenses: { channel: Channel; description: string; amount: string }[];
    cash: { openingCash: string; cashHandovers: string; closingCashActual: string | null };
};
export function salesId(value: unknown): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) return invalid('Invalid UUID');
    return value.toLowerCase();
}
export function salesDate(value: unknown): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('Invalid business date');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '0001-01-01') return invalid('Invalid business date');
    return date;
}
export function salesVersion(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= 2147483647) return invalid('Invalid expectedVersion');
    return value;
}
function money(value: unknown, signed = false): string {
    if (typeof value !== 'string' || !(signed ? /^-?(?:0|[1-9]\d{0,11})$/ : /^(?:0|[1-9]\d{0,11})$/).test(value)) {
        return invalid('Amounts must be canonical integer VND strings (maximum 12 digits)');
    }
    return new Prisma.Decimal(value).toFixed(0);
}
function note(value: unknown, max: number): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.includes('\0') || value.trim().length > max) return invalid('Invalid text field');
    return value.trim() || null;
}
function channel(value: unknown): Channel {
    if (typeof value !== 'string' || !salesChannels.includes(value as Channel)) return invalid('Invalid payment channel');
    return value as Channel;
}
export function parseSalesInput(raw: unknown, updating: boolean): { input: SalesInput; expectedVersion?: number } {
    const body = readBody(raw);
    const keys = ['branchId', 'businessDate', 'shift', 'note', 'discounts', 'lines', 'payments', 'expenses', 'cash'];
    if (!body || !onlyKeys(body, updating ? [...keys, 'expectedVersion'] : keys)) return invalid('Invalid report body');
    const expectedVersion = updating ? salesVersion(body.expectedVersion) : undefined;
    if (typeof body.shift !== 'string' || !['MORNING', 'AFTERNOON', 'EVENING'].includes(body.shift)) return invalid('Invalid shift');
    if (!Array.isArray(body.lines) || body.lines.length > 100) return invalid('Maximum 100 sales lines');
    const lines = body.lines.map(rawLine => {
        const line = readBody(rawLine);
        if (!line || !onlyKeys(line, ['productId', 'productName', 'size', 'quantity', 'unitPrice', 'note'])) return invalid('Invalid sales line');
        if (typeof line.size !== 'string' || !['S', 'M', 'L', 'OTHER'].includes(line.size) || typeof line.quantity !== 'number'
            || !Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 999999) return invalid('Invalid size or quantity');
        const productName = note(line.productName, 200);
        if (!productName) return invalid('Product name is required, including manual draft lines');
        return { productId: line.productId === null ? null : salesId(line.productId), productName,
            size: line.size as string, quantity: line.quantity, unitPrice: money(line.unitPrice), note: note(line.note, 240) };
    });
    if (!Array.isArray(body.payments) || body.payments.length > 5) return invalid('Invalid payments');
    const seen = new Set<Channel>();
    const payments = body.payments.map(rawPayment => {
        const p = readBody(rawPayment);
        if (!p || !onlyKeys(p, ['channel', 'collectedAmount', 'refundedAmount', 'platformFee', 'settlementDifference', 'note'])) return invalid('Invalid payment');
        const c = channel(p.channel);
        if (seen.has(c)) return invalid('Duplicate payment channel');
        seen.add(c);
        return { channel: c, collectedAmount: money(p.collectedAmount), refundedAmount: money(p.refundedAmount),
            platformFee: money(p.platformFee), settlementDifference: money(p.settlementDifference, true), note: note(p.note, 300) };
    });
    if (!Array.isArray(body.expenses) || body.expenses.length > 100) return invalid('Maximum 100 expenses');
    const expenses = body.expenses.map(rawExpense => {
        const e = readBody(rawExpense);
        if (!e || !onlyKeys(e, ['channel', 'description', 'amount'])) return invalid('Invalid expense');
        const description = note(e.description, 300);
        if (!description) return invalid('Expense description is required');
        return { channel: channel(e.channel), description, amount: money(e.amount) };
    });
    const cash = readBody(body.cash);
    if (!cash || !onlyKeys(cash, ['openingCash', 'cashHandovers', 'closingCashActual'])) return invalid('Invalid cash reconciliation');
    const input: SalesInput = {
        branchId: salesId(body.branchId), businessDate: salesDate(body.businessDate), shift: body.shift as Shift,
        note: note(body.note, 1500), discounts: money(body.discounts), lines, payments, expenses,
        cash: { openingCash: money(cash.openingCash), cashHandovers: money(cash.cashHandovers),
            closingCashActual: cash.closingCashActual === null ? null : money(cash.closingCashActual) },
    };
    return expectedVersion === undefined ? { input } : { input, expectedVersion };
}

const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 };
const revisionInclude = {
    lines: { orderBy: { position: 'asc' } }, payments: { orderBy: { channel: 'asc' } },
    expenses: { orderBy: { position: 'asc' } }, cash: true,
} as const;
const reportInclude = { branch: { select: { id: true, code: true, name: true, isActive: true } } } as const;
type Report = Prisma.SalesReportGetPayload<{ include: typeof reportInclude }>;
type Revision = Prisma.SalesReportRevisionGetPayload<{ include: typeof revisionInclude }>;
function scope(actor: SalesActor) { return actor.role === 'ADMIN' ? {} : { branchId: actor.branchId! }; }
async function load(tx: Prisma.TransactionClient, actor: SalesActor, id: string): Promise<Report> {
    const report = await tx.salesReport.findFirst({ where: { id, ...scope(actor) }, include: reportInclude });
    if (!report) throw new SalesReportError('Report not found or inaccessible', 404, 'SALES_REPORT_NOT_FOUND');
    return report;
}
async function current(tx: Prisma.TransactionClient, report: Report): Promise<Revision> {
    const row = await tx.salesReportRevision.findUnique({
        where: { reportId_number: { reportId: report.id, number: report.currentRevisionNumber } }, include: revisionInclude,
    });
    if (!row || !row.cash) return conflict('Report revision is incomplete');
    return row;
}
function actions(report: Report, actor: SalesActor) {
    const editable = report.branch.isActive && report.createdById === actor.id && ['DRAFT', 'RETURNED'].includes(report.status);
    const reviewable = report.branch.isActive && actor.role !== 'STAFF' && report.status === 'SUBMITTED'
        && report.submittedRevisionNumber === report.currentRevisionNumber;
    return { canEdit: editable, canSubmit: editable, canReturn: reviewable,
        canApprove: reviewable && actor.id !== report.submittedById };
}
function serializeRevision(row: Revision) {
    if (!row.cash) return conflict('Report revision is incomplete');
    return {
        id: row.id, reportId: row.reportId, number: row.number, createdById: row.createdById,
        createdAt: row.createdAt.toISOString(), note: row.note, discounts: row.discounts.toFixed(0),
        recognizedRefunds: row.recognizedRefunds.toFixed(0),
        lines: row.lines.map(l => ({ id: l.id, productId: l.productId, productNameSnapshot: l.productNameSnapshot,
            size: l.size, quantity: l.quantity, unitPriceSnapshot: l.unitPriceSnapshot.toFixed(0), note: l.note })),
        payments: row.payments.map(p => ({ id: p.id, channel: p.channel, collectedAmount: p.collectedAmount.toFixed(0),
            refundedAmount: p.refundedAmount.toFixed(0), platformFee: p.platformFee.toFixed(0),
            settlementDifference: p.settlementDifference.toFixed(0), note: p.note })),
        expenses: row.expenses.map(e => ({ id: e.id, channel: e.channel, description: e.description, amount: e.amount.toFixed(0) })),
        cash: { openingCash: row.cash.openingCash.toFixed(0), cashHandovers: row.cash.cashHandovers.toFixed(0),
            closingCashActual: row.cash.closingCashActual?.toFixed(0) ?? null },
        totals: { grossSales: row.grossSales.toFixed(0), netExpected: row.netExpected.toFixed(0), netRecorded: row.netRecorded.toFixed(0),
            salesDifference: row.salesDifference.toFixed(0), expectedCash: row.expectedCash.toFixed(0), cashDifference: row.cashDifference?.toFixed(0) ?? null },
    };
}
async function details(tx: Prisma.TransactionClient, report: Report, actor: SalesActor) {
    return { ...report, businessDate: report.businessDate.toISOString().slice(0, 10),
        createdAt: report.createdAt.toISOString(), updatedAt: report.updatedAt.toISOString(),
        submittedAt: report.submittedAt?.toISOString() ?? null, reviewedAt: report.reviewedAt?.toISOString() ?? null,
        approvedAt: report.approvedAt?.toISOString() ?? null,
        currentRevision: serializeRevision(await current(tx, report)), allowedActions: actions(report, actor), adjustsInventory: false as const };
}

// Catalog validates references only. Saved name/price snapshots never follow later Catalog edits.
async function resolveLines(tx: Prisma.TransactionClient, lines: LineInput[], previous?: Revision) {
    const ids = [...new Set(lines.flatMap(l => l.productId ? [l.productId] : []))];
    const products = await tx.product.findMany({ where: { id: { in: ids } }, include: { variants: true } });
    return lines.map((line, position) => {
        const product = products.find(p => p.id === line.productId);
        if (line.productId && (!product || !product.variants.some(v => v.size === line.size))) {
            return invalid(`Line ${position + 1}: product or size does not exist in PostgreSQL Catalog`);
        }
        // Preserve a historical name even if Catalog has since been renamed.
        const snapshot = previous?.lines.find(l => l.productId === line.productId && l.size === line.size);
        return { position, productId: line.productId,
            productNameSnapshot: line.productId ? snapshot?.productNameSnapshot ?? product!.name : line.productName,
            size: line.size, quantity: line.quantity, unitPriceSnapshot: line.unitPrice, note: line.note };
    });
}
const sum = (values: (Prisma.Decimal | string | number)[]) => values.reduce<Prisma.Decimal>((a, v) => a.plus(v), new Prisma.Decimal(0));
function calculate(input: SalesInput) {
    const grossSales = sum(input.lines.map(l => new Prisma.Decimal(l.unitPrice).times(l.quantity)));
    const recognizedRefunds = sum(input.payments.map(p => p.refundedAmount));
    const netExpected = grossSales.minus(input.discounts).minus(recognizedRefunds);
    const netRecorded = sum(input.payments.map(p => new Prisma.Decimal(p.collectedAmount).minus(p.refundedAmount)));
    const cash = input.payments.find(p => p.channel === 'CASH');
    const expectedCash = new Prisma.Decimal(input.cash.openingCash).plus(cash?.collectedAmount ?? 0)
        .minus(cash?.refundedAmount ?? 0).minus(sum(input.expenses.filter(e => e.channel === 'CASH').map(e => e.amount)))
        .minus(input.cash.cashHandovers);
    const cashDifference = input.cash.closingCashActual === null ? null : new Prisma.Decimal(input.cash.closingCashActual).minus(expectedCash);
    const totals = { grossSales, recognizedRefunds, netExpected, netRecorded, salesDifference: netRecorded.minus(netExpected), expectedCash, cashDifference };
    if (Object.values(totals).some(v => v !== null && v.abs().gte('1000000000000000000'))) return invalid('Calculated total exceeds NUMERIC(18,0)');
    return totals;
}
async function appendRevision(tx: Prisma.TransactionClient, report: Report, actor: SalesActor, input: SalesInput, previous?: Revision) {
    const lines = await resolveLines(tx, input.lines, previous);
    return tx.salesReportRevision.create({ data: {
        reportId: report.id, number: report.currentRevisionNumber, createdById: actor.id,
        note: input.note, discounts: input.discounts, ...calculate(input),
        lines: { create: lines }, payments: { create: input.payments },
        expenses: { create: input.expenses.map((e, position) => ({ ...e, position })) }, cash: { create: input.cash },
    } });
}
async function event(tx: Prisma.TransactionClient, report: Report, actor: SalesActor,
    type: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'RETURNED' | 'APPROVED', reason: string | null = null) {
    await tx.salesReportEvent.create({ data: { reportId: report.id, revisionNumber: report.currentRevisionNumber, actorId: actor.id, type, reason } });
}
async function advance(tx: Prisma.TransactionClient, report: Report, expectedVersion: number, data: Prisma.SalesReportUncheckedUpdateManyInput) {
    if (report.version !== expectedVersion) return conflict();
    const changed = await tx.salesReport.updateMany({ where: { id: report.id, version: expectedVersion, status: report.status },
        data: { ...data, version: { increment: 1 } } });
    if (changed.count !== 1) return conflict();
}
async function validateSubmission(tx: Prisma.TransactionClient, revision: Revision) {
    if (revision.lines.some(l => !l.productId || l.size === 'OTHER' || l.quantity <= 0)) {
        return invalid('Submission requires positive quantities and an explicit Catalog product/size for every line');
    }
    if (!revision.lines.length && !revision.note?.trim()) return invalid('Explain a shift with no sales in the report note before submission');
    if (revision.cash?.closingCashActual === null || !revision.cash) return invalid('Actual closing cash is required before submission');
    if (revision.netExpected.isNegative()) return invalid('Discounts and refunds cannot exceed gross sales');
    const ids = [...new Set(revision.lines.map(l => l.productId!))];
    const products = await tx.product.findMany({ where: { id: { in: ids } }, include: { variants: true } });
    if (revision.lines.some(l => !products.some(p => p.id === l.productId && p.isAvailable && p.variants.some(v => v.size === l.size)))) {
        return invalid('Submission requires available Catalog products and valid sizes. Resolve manual/unavailable lines explicitly.');
    }
}

export type SalesQuery = { page: number; branchId?: string; from?: Date; to?: Date; shift?: Shift; status?: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' };
export function createSalesReportService(db: PrismaClient) {
    const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, txOptions);
    return {
        get: (actor: SalesActor, id: string) => transaction(async tx => details(tx, await load(tx, actor, id), actor)),
        list: (actor: SalesActor, query: SalesQuery) => transaction(async tx => {
            if (actor.role !== 'ADMIN' && query.branchId && query.branchId !== actor.branchId) {
                throw new SalesReportError('Forbidden branch', 403, 'FORBIDDEN');
            }
            const where: Prisma.SalesReportWhereInput = { ...scope(actor),
                ...(query.branchId ? { branchId: query.branchId } : {}), ...(query.shift ? { shift: query.shift } : {}),
                ...(query.status ? { status: query.status } : {}),
                ...((query.from || query.to) ? { businessDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}) };
            const rows = await tx.salesReport.findMany({ where, include: reportInclude, orderBy: [{ businessDate: 'desc' }, { id: 'asc' }],
                skip: (query.page - 1) * 20, take: 20 });
            const items = [];
            for (const report of rows) items.push(await details(tx, report, actor));
            return { items, page: query.page, total: await tx.salesReport.count({ where }) };
        }),
        create: (actor: SalesActor, input: SalesInput) => transaction(async tx => {
            if (actor.role !== 'ADMIN' && input.branchId !== actor.branchId) throw new SalesReportError('Forbidden branch', 403, 'FORBIDDEN');
            const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
            if (!branch?.isActive) return invalid('Active branch is required');
            const report = await tx.salesReport.create({ data: { branchId: input.branchId, businessDate: input.businessDate,
                shift: input.shift, createdById: actor.id }, include: reportInclude });
            await appendRevision(tx, report, actor, input);
            await event(tx, report, actor, 'CREATED');
            return details(tx, report, actor);
        }),
        update: (actor: SalesActor, id: string, input: SalesInput, expectedVersion: number) => transaction(async tx => {
            const report = await load(tx, actor, id);
            if (report.version !== expectedVersion) return conflict();
            if (!actions(report, actor).canEdit) throw new SalesReportError('Only the creator can edit an active draft or returned report', 403, 'FORBIDDEN');
            if (input.branchId !== report.branchId || input.businessDate.getTime() !== report.businessDate.getTime() || input.shift !== report.shift) {
                return invalid('Branch, business date and shift cannot change after creation');
            }
            const previous = await current(tx, report);
            await advance(tx, report, expectedVersion, { currentRevisionNumber: { increment: 1 } });
            const updated = await load(tx, actor, id);
            await appendRevision(tx, updated, actor, input, previous);
            await event(tx, updated, actor, 'UPDATED');
            return details(tx, updated, actor);
        }),
        submit: (actor: SalesActor, id: string, expectedVersion: number) => transaction(async tx => {
            const report = await load(tx, actor, id);
            if (report.version !== expectedVersion) return conflict();
            if (!actions(report, actor).canSubmit) throw new SalesReportError('Report cannot be submitted by this user', 403, 'FORBIDDEN');
            await validateSubmission(tx, await current(tx, report));
            await advance(tx, report, expectedVersion, { status: 'SUBMITTED', submittedById: actor.id, submittedAt: new Date(),
                submittedRevisionNumber: report.currentRevisionNumber, reviewedById: null, reviewedAt: null, returnReason: null });
            const updated = await load(tx, actor, id);
            await event(tx, updated, actor, 'SUBMITTED');
            return details(tx, updated, actor);
        }),
        review: (actor: SalesActor, id: string, expectedVersion: number, revisionNumber: number, decision: 'RETURNED' | 'APPROVED', reason: string | null) => transaction(async tx => {
            const report = await load(tx, actor, id);
            if (actor.role === 'STAFF') throw new SalesReportError('Manager access required', 403, 'FORBIDDEN');
            if (report.version !== expectedVersion || report.status !== 'SUBMITTED' || revisionNumber !== report.submittedRevisionNumber
                || revisionNumber !== report.currentRevisionNumber) return conflict('Submitted revision is stale or report is no longer submitted');
            if (!report.branch.isActive) return conflict('Branch is inactive');
            if (decision === 'APPROVED' && report.submittedById === actor.id) throw new SalesReportError('Cannot approve your own submitted report', 403, 'SELF_APPROVAL_FORBIDDEN');
            if (decision === 'RETURNED' && !reason?.trim()) return invalid('Return reason is required');
            await advance(tx, report, expectedVersion, { status: decision, reviewedById: actor.id, reviewedAt: new Date(),
                ...(decision === 'APPROVED' ? { approvedAt: new Date(), approvedRevisionNumber: revisionNumber, returnReason: null } : { returnReason: reason }) });
            const updated = await load(tx, actor, id);
            await event(tx, updated, actor, decision, reason);
            return details(tx, updated, actor);
        }),
        revisions: (actor: SalesActor, id: string) => transaction(async tx => {
            await load(tx, actor, id);
            const rows = await tx.salesReportRevision.findMany({ where: { reportId: id }, include: revisionInclude, orderBy: { number: 'desc' } });
            const events = await tx.salesReportEvent.findMany({ where: { reportId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
            return { revisions: rows.map(serializeRevision), events: events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })) };
        }),
    };
}
