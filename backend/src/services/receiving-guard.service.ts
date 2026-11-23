import { Prisma } from '../generated/prisma/client';
import { prismaErrorCode } from '../utils/admin-api';

export class ReceivingGuardError extends Error {
    readonly status = 409;
    constructor(message: string, public readonly code: string) {
        super(message);
    }
}

/**
 * A write barrier, not just an advisory/read lock. Under Serializable a stale
 * snapshot must abort when another gated transaction has touched this row.
 * Call inside the SAME transaction as posting/confirming/submitting/approving.
 * No inventory balance or movement is written here.
 */
export async function lockReceivingBranches(tx: Prisma.TransactionClient, ids: string[]) {
    const revisions = new Map<string, { receivingRevision: number; inventoryRevision: number }>();
    for (const id of [...new Set(ids)].sort()) {
        const rows = await tx.$queryRaw<Array<{ receivingRevision: number; inventoryRevision: number; isActive: boolean }>>`
            UPDATE "branches" SET "receiving_revision" = "receiving_revision"
            WHERE "id" = CAST(${id} AS uuid)
            RETURNING "receiving_revision" AS "receivingRevision",
                "inventory_revision" AS "inventoryRevision", "is_active" AS "isActive"
        `;
        if (!rows[0]?.isActive) {
            throw new ReceivingGuardError('Source or destination branch unavailable', 'BRANCH_UNAVAILABLE');
        }
        revisions.set(id, { receivingRevision: rows[0].receivingRevision, inventoryRevision: rows[0].inventoryRevision });
    }
    return revisions;
}

export async function assertNoPendingReceipts(tx: Prisma.TransactionClient, branchId: string) {
    const pending = await tx.stockDocument.findFirst({
        where: {
            type: 'TRANSFER', status: 'POSTED', destinationBranchId: branchId,
            OR: [
                { transferReceipt: { is: null } },
                { transferReceipt: { is: { status: 'DRAFT' } } },
            ],
        },
        select: { id: true },
    });
    if (pending) {
        throw new ReceivingGuardError(
            'Posted incoming transfers await receiving. Confirm physical receipts and recount before submitting or approving.',
            'PENDING_TRANSFER_RECEIPTS'
        );
    }
}

export async function captureReceivingRevision(tx: Prisma.TransactionClient, branchId: string): Promise<number> {
    return (await captureStockCountRevisions(tx, branchId)).receivingRevision;
}

export async function captureStockCountRevisions(tx: Prisma.TransactionClient, branchId: string) {
    const revisions = await lockReceivingBranches(tx, [branchId]);
    await assertNoPendingReceipts(tx, branchId);
    return revisions.get(branchId)!;
}

export async function assertStockCountRevisions(
    tx: Prisma.TransactionClient, branchId: string, receivingSnapshot: number | null, inventorySnapshot: number | null
) {
    const current = await captureStockCountRevisions(tx, branchId);
    if (receivingSnapshot === null || current.receivingRevision !== receivingSnapshot) {
        throw new ReceivingGuardError('Receiving changed or the snapshot predates W7.2. Return and recount.', 'RECEIVING_SNAPSHOT_CHANGED');
    }
    if (inventorySnapshot === null || current.inventoryRevision !== inventorySnapshot) {
        throw new ReceivingGuardError('Inventory changed or the snapshot predates W7.2. Return and recount.', 'INVENTORY_SNAPSHOT_CHANGED');
    }
}

export async function assertReceivingRevision(tx: Prisma.TransactionClient, branchId: string, snapshot: number | null) {
    const current = await captureReceivingRevision(tx, branchId);
    if (snapshot === null || current !== snapshot) {
        throw new ReceivingGuardError(
            'Receiving changed or the snapshot predates W7.2. Return the count and recount before resubmission.',
            'RECEIVING_SNAPSHOT_CHANGED'
        );
    }
}

export function isReceivingTransactionConflict(error: unknown): boolean {
    if (prismaErrorCode(error) === 'P2034') return true;
    if (prismaErrorCode(error) !== 'P2010' || !error || typeof error !== 'object') return false;
    const meta = (error as { meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta;
    return [meta?.code, meta?.driverAdapterError?.cause?.originalCode]
        .some(code => code === '40001' || code === '40P01');
}
