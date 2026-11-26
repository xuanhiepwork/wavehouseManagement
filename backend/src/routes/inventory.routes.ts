import { Router } from 'express';
import { canOperateBranch, type OperationalActor } from '../services/operational-access.service';
import type { PrismaClient } from '../generated/prisma/client';
import { UUID_RE, readPage } from '../utils/admin-api';

type AuthUser = OperationalActor;

// Keep metadata tied to the ingredient referenced by each persisted balance or
// movement. Clients must not infer units or minimum stock from display labels.
const ingredientSelect = {
    id: true,
    code: true,
    name: true,
    unit: true,
    minStock: true,
    isActive: true,
} as const;

export function createInventoryRouter(prisma: PrismaClient) {
    const router = Router();

    router.use(async (req, res, next) => {
        const actor = res.locals.authUser as AuthUser | undefined;
        const requested = req.query.branchId;
        if (!actor) { res.status(401).json({ error: 'Unauthorized' }); return; }
        if (requested !== undefined && (typeof requested !== 'string' || !UUID_RE.test(requested))) {
            res.status(400).json({ error: 'Invalid branch ID' }); return;
        }
        // Area accounts must explicitly select their operational branch.
        const branchId = typeof requested === 'string' ? requested.toLowerCase() :
            (!actor.areaId ? actor.branchId : null);
        if (!branchId) { res.status(400).json({ error: 'branchId is required' }); return; }
        try {
            if (!(await canOperateBranch(prisma, actor, branchId))) {
                res.status(403).json({ error: 'Branch not assigned or outside managed area' }); return;
            }
            res.locals.inventoryBranchId = branchId;
            next();
        } catch {
            res.status(503).json({ error: 'Inventory access temporarily unavailable' });
        }
    });

    // GET /api/inventory/balances?branchId=<uuid>&page=1
    router.get('/balances', async (req, res) => {
        const page = readPage(req.query.page);
        const ingredientId = req.query.ingredientId;

        if (
            page === null ||
            (
                ingredientId !== undefined &&
                (
                    typeof ingredientId !== 'string' ||
                    !UUID_RE.test(ingredientId)
                )
            )
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        const branchId = res.locals.inventoryBranchId as string;
        const where = {
            branchId,
            ...(typeof ingredientId === 'string' ? { ingredientId } : {}),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.inventoryBalance.count({
                    where,
                }),
                prisma.inventoryBalance.findMany({
                    where,
                    select: {
                        branchId: true,
                        ingredientId: true,
                        quantity: true,
                        updatedAt: true,
                        ingredient: { select: ingredientSelect },
                    },
                    orderBy: { ingredientId: 'asc' },
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, page, total });
        } catch {
            res.status(503).json({
                error: 'Inventory database unavailable',
            });
        }
    });

    // GET /api/inventory/movements?branchId=<uuid>&page=1
    router.get('/movements', async (req, res) => {
        const page = readPage(req.query.page);
        const ingredientId = req.query.ingredientId;

        if (
            page === null ||
            (
                ingredientId !== undefined &&
                (
                    typeof ingredientId !== 'string' ||
                    !UUID_RE.test(ingredientId)
                )
            )
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        const branchId = res.locals.inventoryBranchId as string;
        const where = {
            branchId,
            ...(typeof ingredientId === 'string'
                ? { ingredientId }
                : {}),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.inventoryMovement.count({ where }),
                prisma.inventoryMovement.findMany({
                    where,
                    select: {
                        id: true,
                        branchId: true,
                        ingredientId: true,
                        actorId: true,
                        kind: true,
                        sourceId: true,
                        delta: true,
                        quantityAfter: true,
                        createdAt: true,
                        ingredient: { select: ingredientSelect },
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' },
                    ],
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, page, total });
        } catch {
            res.status(503).json({
                error: 'Inventory history unavailable',
            });
        }
    });

    return router;
}
