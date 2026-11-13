import { Prisma } from '../generated/prisma/client';
import type { InventoryMovementKind } from '../generated/prisma/enums';
import { UUID_RE } from '../utils/admin-api';

export type StockChange = {
    branchId: string;
    ingredientId: string;
    actorId: string;
    sourceId: string;
    kind: InventoryMovementKind;
    delta: string;
};

export class InventoryError extends Error {
    constructor(
        message: string,
        public readonly status: number
    ) {
        super(message);
        this.name = 'InventoryError';
    }
}

/**
 * Must be called inside a Prisma transaction.
 * One sourceId represents one business document/operation.
 */
export async function applyInventoryMovement(
    tx: Prisma.TransactionClient,
    input: StockChange
) {
    const { branchId, ingredientId, actorId, sourceId, kind, delta } = input;

    if (
        ![branchId, ingredientId, actorId, sourceId].every(
            id => UUID_RE.test(id)
        ) ||
        !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(delta)
    ) {
        throw new InventoryError('Invalid inventory movement', 400);
    }

    const change = new Prisma.Decimal(delta);

    if (change.isZero()) {
        throw new InventoryError('Quantity change cannot be zero', 400);
    }

    const [branch, ingredient, actor] = await Promise.all([
        tx.branch.findUnique({
            where: { id: branchId },
            select: { isActive: true },
        }),
        tx.ingredient.findUnique({
            where: { id: ingredientId },
            select: { id: true },
        }),
        tx.user.findUnique({
            where: { id: actorId },
            select: {
                isActive: true,
                role: true,
                branchId: true,
            },
        }),
    ]);

    if (!branch?.isActive || !ingredient) {
        throw new InventoryError(
            'Branch or ingredient is unavailable',
            409
        );
    }

    if (
        !actor?.isActive ||
        (
            actor.role !== 'ADMIN' &&
            actor.branchId !== branchId
        )
    ) {
        throw new InventoryError('Inventory access denied', 403);
    }

    // Prevent the same document from posting the same movement twice.
    const existing = await tx.inventoryMovement.findUnique({
        where: {
            kind_sourceId_branchId_ingredientId: {
                kind,
                sourceId,
                branchId,
                ingredientId,
            },
        },
        select: { id: true },
    });

    if (existing) {
        throw new InventoryError('Inventory movement already posted', 409);
    }

    // Create an initial zero balance if it does not exist.
    // ON CONFLICT handles concurrent requests for the same balance.
    await tx.$executeRaw`
        INSERT INTO "inventory_balances"
            ("branch_id", "ingredient_id", "quantity")
        VALUES (
            CAST(${branchId} AS uuid),
            CAST(${ingredientId} AS uuid),
            0
        )
        ON CONFLICT ("branch_id", "ingredient_id") DO NOTHING
    `;

    // Atomic conditional update; no negative inventory allowed.
    const updated = await tx.$queryRaw<
        Array<{ quantity: Prisma.Decimal }>
    >`
        UPDATE "inventory_balances"
        SET
            "quantity" = "quantity" + CAST(${delta} AS numeric),
            "updated_at" = CURRENT_TIMESTAMP
        WHERE
            "branch_id" = CAST(${branchId} AS uuid)
            AND "ingredient_id" = CAST(${ingredientId} AS uuid)
            AND "quantity" + CAST(${delta} AS numeric) >= 0
        RETURNING "quantity"
    `;

    const balance = updated[0];

    if (!balance || updated.length !== 1) {
        throw new InventoryError('Insufficient inventory', 409);
    }

    // Movement is written in the same transaction as the balance.
    return tx.inventoryMovement.create({
        data: {
            branchId,
            ingredientId,
            actorId,
            kind,
            sourceId,
            delta: change,
            quantityAfter: balance.quantity,
        },
        select: {
            id: true,
            branchId: true,
            ingredientId: true,
            kind: true,
            sourceId: true,
            delta: true,
            quantityAfter: true,
            createdAt: true,
        },
    });
}