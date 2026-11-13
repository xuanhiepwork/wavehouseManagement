import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { UUID_RE, readPage } from '../utils/admin-api';

type AuthUser = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    branchId: string | null;
};

export function createInventoryRouter(prisma: PrismaClient) {
    const router = Router();

    router.use((req, res, next) => {
        const actor = res.locals.authUser as AuthUser | undefined;
        const requestedBranch = req.query.branchId;

        if (!actor) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (
            requestedBranch !== undefined &&
            (
                typeof requestedBranch !== 'string' ||
                !UUID_RE.test(requestedBranch)
            )
        ) {
            res.status(400).json({ error: 'Invalid branch ID' });
            return;
        }

        if (actor.role === 'ADMIN') {
            if (!requestedBranch) {
                res.status(400).json({
                    error: 'branchId is required for ADMIN',
                });
                return;
            }

            res.locals.inventoryBranchId = requestedBranch;
        } else {
            if (
                !actor.branchId ||
                (
                    requestedBranch &&
                    requestedBranch !== actor.branchId
                )
            ) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            res.locals.inventoryBranchId = actor.branchId;
        }

        next();
    });

    // GET /api/inventory/balances?branchId=<uuid>&page=1
    router.get('/balances', async (req, res) => {
        const page = readPage(req.query.page);

        if (page === null) {
            res.status(400).json({ error: 'Invalid page' });
            return;
        }

        const branchId = res.locals.inventoryBranchId as string;

        try {
            const [total, items] = await Promise.all([
                prisma.inventoryBalance.count({
                    where: { branchId },
                }),
                prisma.inventoryBalance.findMany({
                    where: { branchId },
                    select: {
                        branchId: true,
                        ingredientId: true,
                        quantity: true,
                        updatedAt: true,
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