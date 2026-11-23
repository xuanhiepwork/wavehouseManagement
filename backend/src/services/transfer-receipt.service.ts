import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, readBody, UUID_RE } from '../utils/admin-api';
import { lockReceivingBranches } from './receiving-guard.service';

export type ReceivingActor = { id: string; role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF'; branchId: string | null };
export class TransferReceiptError extends Error {
    constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}
const invalid = (message = 'Invalid receiving request'): never => {
    throw new TransferReceiptError(message, 400, 'INVALID_RECEIPT');
};
export const receivingTxOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000,
};
const branchSelect = { id: true, code: true, name: true, isActive: true } as const;
const transferSelect = {
    id: true, code: true, type: true, status: true,
    sourceBranchId: true, destinationBranchId: true, postedAt: true, legacyReceivingRequired: true,
    sourceBranch: { select: branchSelect }, destinationBranch: { select: branchSelect },
    items: {
        select: {
            ingredientId: true, quantity: true,
            ingredient: { select: { code: true, name: true, unit: true } },
        },
        orderBy: { ingredientId: 'asc' },
    },
} as const;
const receiptInclude = { items: { orderBy: { ingredientId: 'asc' } } } as const;
type Transfer = Prisma.StockDocumentGetPayload<{ select: typeof transferSelect }>;
type Receipt = Prisma.TransferReceiptGetPayload<{ include: typeof receiptInclude }>;

export type ReceivingActionsDto = { canCreate: boolean; canEdit: boolean; canConfirm: boolean };
export type TransferReceiptItemDto = {
    ingredientId: string; code: string; name: string; unit: string;
    plannedQuantity: string; receivedQuantity: string; damagedQuantity: string;
    usableQuantity: string; shortageQuantity: string; overageQuantity: string;
    hasDiscrepancy: boolean; discrepancyReason: string | null;
};
export type TransferReceiptDto = {
    id: string; stockDocumentId: string; status: 'DRAFT' | 'CONFIRMED'; version: number;
    note: string | null; createdById: string; receivedById: string | null;
    physicalReceivedAt: string | null; legacyEvidence: string | null;
    createdAt: string; updatedAt: string; confirmedAt: string | null;
    discrepancyCount: number; items: TransferReceiptItemDto[];
};
export type ReceivingDetailsDto = {
    transfer: {
        id: string; code: string; status: 'POSTED'; inventoryPosted: true;
        sourceBranchId: string; destinationBranchId: string;
        sourceBranch: { id: string; code: string; name: string };
        destinationBranch: { id: string; code: string; name: string };
        postedAt: string | null; legacyReceivingRequired: boolean;
        items: { ingredientId: string; code: string; name: string; unit: string; plannedQuantity: string }[];
    };
    receipt: TransferReceiptDto | null;
    receivingStatus: 'AWAITING_RECEIVING' | 'DRAFT' | 'CONFIRMED';
    adjustsInventory: false;
    allowedActions: ReceivingActionsDto;
};

type InputLine = {
    ingredientId: string; receivedQuantity: string; damagedQuantity: string; discrepancyReason: string | null;
};
export type ReceivingInput = {
    note?: string | null; items?: InputLine[]; expectedVersion?: number;
    physicalReceivedAt?: Date; legacyEvidence?: string;
};

export function parseReceivingInput(raw: unknown, mode: 'create' | 'update' | 'confirm'): ReceivingInput {
    const body = readBody(raw);
    const allowed = mode === 'create' ? ['note', 'items', 'physicalReceivedAt', 'legacyEvidence']
        : mode === 'update' ? ['expectedVersion', 'note', 'items', 'physicalReceivedAt', 'legacyEvidence'] : ['expectedVersion'];
    if (!body || !onlyKeys(body, allowed)) return invalid();
    const result: ReceivingInput = {};
    if (mode !== 'create') {
        if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion)
            || body.expectedVersion < 1 || body.expectedVersion >= 2147483647) return invalid('Invalid expectedVersion');
        result.expectedVersion = body.expectedVersion;
    }
    if (mode === 'update' && body.note === undefined && body.items === undefined
        && body.physicalReceivedAt === undefined && body.legacyEvidence === undefined) return invalid('No receiving changes supplied');
    if (body.physicalReceivedAt !== undefined || body.legacyEvidence !== undefined) {
        if (typeof body.physicalReceivedAt !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.physicalReceivedAt)
            || !Number.isFinite(Date.parse(body.physicalReceivedAt))
            || new Date(body.physicalReceivedAt).toISOString() !== (body.physicalReceivedAt.length === 20
                ? body.physicalReceivedAt.slice(0, -1) + '.000Z' : body.physicalReceivedAt)
            || typeof body.legacyEvidence !== 'string' || !body.legacyEvidence.trim()
            || body.legacyEvidence.trim().length > 1000) return invalid('Legacy reconciliation requires a valid UTC receipt date and evidence reference');
        result.physicalReceivedAt = new Date(body.physicalReceivedAt);
        result.legacyEvidence = body.legacyEvidence.trim();
    }
    if (body.note !== undefined) {
        if (body.note !== null && (typeof body.note !== 'string' || body.note.trim().length > 500)) return invalid('Invalid note');
        result.note = typeof body.note === 'string' ? body.note.trim() || null : null;
    }
    if (mode === 'create' || body.items !== undefined) {
        if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return invalid('Expected 1–50 receiving items');
        const seen = new Set<string>();
        result.items = body.items.map(rawItem => {
            const item = readBody(rawItem);
            if (!item || !onlyKeys(item, ['ingredientId', 'receivedQuantity', 'damagedQuantity', 'discrepancyReason'])) return invalid();
            const { ingredientId, receivedQuantity, damagedQuantity, discrepancyReason } = item;
            const quantity = (value: unknown): value is string => typeof value === 'string'
                && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value);
            if (typeof ingredientId !== 'string' || !UUID_RE.test(ingredientId)
                || !quantity(receivedQuantity) || !quantity(damagedQuantity)) return invalid('Invalid receiving quantities or ingredient ID');
            const id = ingredientId.toLowerCase();
            if (seen.has(id)) return invalid('Duplicate receiving ingredient');
            seen.add(id);
            if (new Prisma.Decimal(damagedQuantity).gt(receivedQuantity)) return invalid('Damaged quantity cannot exceed received quantity');
            if (discrepancyReason !== undefined && discrepancyReason !== null
                && (typeof discrepancyReason !== 'string' || discrepancyReason.trim().length > 300)) return invalid('Invalid discrepancy explanation');
            return {
                ingredientId: id, receivedQuantity, damagedQuantity,
                discrepancyReason: typeof discrepancyReason === 'string' ? discrepancyReason.trim() || null : null,
            };
        });
    }
    return result;
}

function destinationScope(actor: ReceivingActor) {
    return actor.role === 'ADMIN' ? {} : { destinationBranchId: actor.branchId! };
}
async function loadTransfer(tx: Prisma.TransactionClient, actor: ReceivingActor, id: string, writing = false): Promise<Transfer> {
    const transfer = await tx.stockDocument.findFirst({
        where: { id, type: 'TRANSFER', ...destinationScope(actor) }, select: transferSelect,
    });
    if (!transfer) throw new TransferReceiptError('Transfer not found or inaccessible', 404, 'TRANSFER_NOT_FOUND');
    if (transfer.status !== 'POSTED') throw new TransferReceiptError('Only POSTED transfers can be received', 409, 'TRANSFER_NOT_POSTED');
    if (!transfer.destinationBranch || transfer.sourceBranchId === transfer.destinationBranchId || !transfer.items.length) {
        throw new TransferReceiptError('Invalid transfer destination or items', 409, 'TRANSFER_UNAVAILABLE');
    }
    if (writing && (!transfer.sourceBranch.isActive || !transfer.destinationBranch.isActive)) {
        throw new TransferReceiptError('Source or destination branch is inactive', 409, 'TRANSFER_UNAVAILABLE');
    }
    if (writing && transfer.legacyReceivingRequired && actor.role === 'STAFF') {
        throw new TransferReceiptError('Legacy receiving requires ADMIN or the destination branch manager', 403, 'LEGACY_RECONCILIATION_FORBIDDEN');
    }
    return transfer;
}

function legacyMetadata(transfer: Transfer, input: ReceivingInput, existing?: Receipt) {
    if (!transfer.legacyReceivingRequired) {
        if (input.physicalReceivedAt !== undefined || input.legacyEvidence !== undefined) return invalid('Legacy metadata is only allowed on historical transfers');
        return {};
    }
    const physicalReceivedAt = input.physicalReceivedAt ?? existing?.physicalReceivedAt;
    const legacyEvidence = input.legacyEvidence ?? existing?.legacyEvidence;
    if (!physicalReceivedAt || !legacyEvidence?.trim() || physicalReceivedAt.getTime() > Date.now()) {
        return invalid('Verify actual quantities, physical receipt date and documentary evidence before reconciling a legacy transfer');
    }
    return { physicalReceivedAt, legacyEvidence };
}

function validateItems(transfer: Transfer, lines: InputLine[], existing?: Receipt) {
    if (lines.length !== transfer.items.length) return invalid('Receiving items must cover the complete transfer');
    const byId = new Map(lines.map(item => [item.ingredientId, item]));
    const snapshots = new Map(existing?.items.map(item => [item.ingredientId, item]));
    return transfer.items.map(item => {
        const line = byId.get(item.ingredientId);
        if (!line) return invalid('Receiving items must match the transfer');
        const snapshot = snapshots.get(item.ingredientId);
        const unit = snapshot?.unit ?? item.ingredient.unit;
        const received = new Prisma.Decimal(line.receivedQuantity);
        const damaged = new Prisma.Decimal(line.damagedQuantity);
        if (unit === 'piece' && (!received.isInteger() || !damaged.isInteger())) return invalid('Piece quantities must be whole numbers');
        if (!received.eq(item.quantity) || damaged.gt(0)) {
            if (!line.discrepancyReason) return invalid('Shortage, overage or damage requires an explanation');
        }
        return {
            ingredientId: item.ingredientId,
            ingredientCode: snapshot?.ingredientCode ?? item.ingredient.code,
            ingredientName: snapshot?.ingredientName ?? item.ingredient.name,
            unit, plannedQuantity: snapshot?.plannedQuantity ?? item.quantity,
            receivedQuantity: line.receivedQuantity, damagedQuantity: line.damagedQuantity,
            discrepancyReason: line.discrepancyReason,
        };
    });
}

function serializeReceipt(receipt: Receipt): TransferReceiptDto {
    const items = receipt.items.map(item => {
        const delta = item.receivedQuantity.minus(item.plannedQuantity);
        return {
            ingredientId: item.ingredientId, code: item.ingredientCode, name: item.ingredientName, unit: item.unit,
            plannedQuantity: item.plannedQuantity.toFixed(6), receivedQuantity: item.receivedQuantity.toFixed(6),
            damagedQuantity: item.damagedQuantity.toFixed(6), usableQuantity: item.receivedQuantity.minus(item.damagedQuantity).toFixed(6),
            shortageQuantity: Prisma.Decimal.max(delta.negated(), 0).toFixed(6),
            overageQuantity: Prisma.Decimal.max(delta, 0).toFixed(6),
            hasDiscrepancy: !delta.isZero() || !item.damagedQuantity.isZero(), discrepancyReason: item.discrepancyReason,
        };
    });
    return {
        id: receipt.id, stockDocumentId: receipt.stockDocumentId, status: receipt.status, version: receipt.version,
        note: receipt.note, createdById: receipt.createdById, receivedById: receipt.receivedById,
        physicalReceivedAt: receipt.physicalReceivedAt?.toISOString() ?? null, legacyEvidence: receipt.legacyEvidence ?? null,
        createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString(), confirmedAt: receipt.confirmedAt?.toISOString() ?? null,
        discrepancyCount: items.filter(item => item.hasDiscrepancy).length, items,
    };
}
function details(transfer: Transfer, receipt: Receipt | null, actor: ReceivingActor): ReceivingDetailsDto {
    const available = transfer.sourceBranch.isActive && transfer.destinationBranch!.isActive
        && (!transfer.legacyReceivingRequired || actor.role !== 'STAFF');
    return {
        transfer: {
            id: transfer.id, code: transfer.code, status: 'POSTED', inventoryPosted: true,
            sourceBranchId: transfer.sourceBranchId, destinationBranchId: transfer.destinationBranchId!,
            sourceBranch: { id: transfer.sourceBranch.id, code: transfer.sourceBranch.code, name: transfer.sourceBranch.name },
            destinationBranch: { id: transfer.destinationBranch!.id, code: transfer.destinationBranch!.code, name: transfer.destinationBranch!.name },
            postedAt: transfer.postedAt?.toISOString() ?? null, legacyReceivingRequired: transfer.legacyReceivingRequired,
            items: transfer.items.map(item => ({ ingredientId: item.ingredientId, code: item.ingredient.code,
                name: item.ingredient.name, unit: item.ingredient.unit, plannedQuantity: item.quantity.toFixed(6) })),
        },
        receipt: receipt ? serializeReceipt(receipt) : null,
        receivingStatus: receipt?.status ?? 'AWAITING_RECEIVING', adjustsInventory: false,
        allowedActions: { canCreate: available && !receipt, canEdit: available && receipt?.status === 'DRAFT', canConfirm: available && receipt?.status === 'DRAFT' },
    };
}
function sameDraft(receipt: Receipt, input: ReceivingInput): boolean {
    if ((receipt.legacyEvidence ?? null) !== (input.legacyEvidence ?? null)
        || (receipt.physicalReceivedAt?.getTime() ?? null) !== (input.physicalReceivedAt?.getTime() ?? null)) return false;
    if (receipt.note !== (input.note ?? null) || !input.items || receipt.items.length !== input.items.length) return false;
    const byId = new Map(input.items.map(item => [item.ingredientId, item]));
    return receipt.items.every(item => {
        const line = byId.get(item.ingredientId);
        return line && item.receivedQuantity.eq(line.receivedQuantity) && item.damagedQuantity.eq(line.damagedQuantity)
            && item.discrepancyReason === line.discrepancyReason;
    });
}

export function createTransferReceiptService(prisma: PrismaClient) {
    return {
        async get(actor: ReceivingActor, transferId: string) {
            return prisma.$transaction(async tx => {
                const transfer = await loadTransfer(tx, actor, transferId);
                const receipt = await tx.transferReceipt.findUnique({ where: { stockDocumentId: transfer.id }, include: receiptInclude });
                return details(transfer, receipt, actor);
            }, { ...receivingTxOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        },
        async list(actor: ReceivingActor, query: { page: number; destinationBranchId?: string; status?: 'DRAFT' | 'CONFIRMED' }) {
            if (actor.role !== 'ADMIN' && query.destinationBranchId && query.destinationBranchId !== actor.branchId) {
                throw new TransferReceiptError('Forbidden', 403, 'RECEIVING_FORBIDDEN');
            }
            const where: Prisma.TransferReceiptWhereInput = {
                ...(query.status ? { status: query.status } : {}),
                stockDocument: { is: { type: 'TRANSFER', status: 'POSTED', ...destinationScope(actor),
                    ...(query.destinationBranchId ? { destinationBranchId: query.destinationBranchId } : {}) } },
            };
            return prisma.$transaction(async tx => {
                const total = await tx.transferReceipt.count({ where });
                const rows = await tx.transferReceipt.findMany({
                    where, include: { ...receiptInclude, stockDocument: { select: transferSelect } },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * 50, take: 50,
                });
                return { items: rows.map(row => details(row.stockDocument, row, actor)), page: query.page, total, pageSize: 50, totalPages: Math.ceil(total / 50) };
            }, { ...receivingTxOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        },
        async create(actor: ReceivingActor, transferId: string, input: ReceivingInput) {
            return prisma.$transaction(async tx => {
                const transfer = await loadTransfer(tx, actor, transferId, true);
                await lockReceivingBranches(tx, [transfer.destinationBranchId!]);
                const legacy = legacyMetadata(transfer, input);
                const existing = await tx.transferReceipt.findUnique({ where: { stockDocumentId: transferId }, include: receiptInclude });
                if (existing) {
                    // Create is replay-safe only when the persisted content already matches.
                    if (sameDraft(existing, input)) return { data: details(transfer, existing, actor), replayed: true };
                    throw new TransferReceiptError('A receipt already exists. Reload before editing.', 409, 'RECEIPT_ALREADY_EXISTS');
                }
                const items = validateItems(transfer, input.items!);
                const receipt = await tx.transferReceipt.create({
                    data: { stockDocumentId: transfer.id, note: input.note ?? null, createdById: actor.id, ...legacy, items: { create: items } },
                    include: receiptInclude,
                });
                return { data: details(transfer, receipt, actor), replayed: false };
            }, receivingTxOptions);
        },
        async update(actor: ReceivingActor, receiptId: string, input: ReceivingInput) {
            return prisma.$transaction(async tx => {
                const current = await tx.transferReceipt.findFirst({
                    where: { id: receiptId, stockDocument: { is: destinationScope(actor) } }, include: receiptInclude,
                });
                if (!current) throw new TransferReceiptError('Receipt not found or inaccessible', 404, 'RECEIPT_NOT_FOUND');
                const transfer = await loadTransfer(tx, actor, current.stockDocumentId, true);
                await lockReceivingBranches(tx, [transfer.destinationBranchId!]);
                if (current.status !== 'DRAFT') throw new TransferReceiptError('Confirmed receipts cannot be edited', 409, 'RECEIPT_CONFIRMED');
                if (current.version !== input.expectedVersion) throw new TransferReceiptError('Receipt changed. Reload before editing.', 409, 'STALE_RECEIPT_VERSION');
                const legacy = legacyMetadata(transfer, input, current);
                const items = input.items ? validateItems(transfer, input.items, current) : undefined;
                const changed = await tx.transferReceipt.updateMany({
                    where: { id: receiptId, status: 'DRAFT', version: input.expectedVersion! },
                    data: { version: { increment: 1 }, ...legacy, ...(input.note !== undefined ? { note: input.note } : {}) },
                });
                if (changed.count !== 1) throw new TransferReceiptError('Receipt changed. Reload.', 409, 'STALE_RECEIPT_VERSION');
                if (items) {
                    for (const item of items) {
                        await tx.transferReceiptItem.update({ where: { receiptId_ingredientId: { receiptId, ingredientId: item.ingredientId } }, data: item });
                    }
                }
                const receipt = await tx.transferReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: receiptInclude });
                return details(transfer, receipt, actor);
            }, receivingTxOptions);
        },
        async confirm(actor: ReceivingActor, receiptId: string, expectedVersion: number) {
            return prisma.$transaction(async tx => {
                const current = await tx.transferReceipt.findFirst({
                    where: { id: receiptId, stockDocument: { is: destinationScope(actor) } }, include: receiptInclude,
                });
                if (!current) throw new TransferReceiptError('Receipt not found or inaccessible', 404, 'RECEIPT_NOT_FOUND');
                const transfer = await loadTransfer(tx, actor, current.stockDocumentId, true);
                await lockReceivingBranches(tx, [transfer.destinationBranchId!]);
                // A repeat confirmation returns the canonical immutable result, never increments twice.
                if (current.status === 'CONFIRMED') return { data: details(transfer, current, actor), replayed: true };
                if (current.version !== expectedVersion) throw new TransferReceiptError('Receipt changed. Reload before confirming.', 409, 'STALE_RECEIPT_VERSION');
                legacyMetadata(transfer, {}, current);
                validateItems(transfer, current.items.map(item => ({
                    ingredientId: item.ingredientId, receivedQuantity: item.receivedQuantity.toFixed(6),
                    damagedQuantity: item.damagedQuantity.toFixed(6), discrepancyReason: item.discrepancyReason,
                })), current);
                const changed = await tx.transferReceipt.updateMany({
                    where: { id: receiptId, status: 'DRAFT', version: expectedVersion },
                    data: { status: 'CONFIRMED', version: { increment: 1 }, receivedById: actor.id, confirmedAt: new Date() },
                });
                if (changed.count !== 1) throw new TransferReceiptError('Receipt changed. Reload.', 409, 'STALE_RECEIPT_VERSION');
                await tx.branch.update({ where: { id: transfer.destinationBranchId! }, data: { receivingRevision: { increment: 1 } } });
                const receipt = await tx.transferReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: receiptInclude });
                // Deliberately NO inventory service, balances, or movements in this operation.
                return { data: details(transfer, receipt, actor), replayed: false };
            }, receivingTxOptions);
        },
    };
}
