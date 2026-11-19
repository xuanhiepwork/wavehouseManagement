
import { Router, type RequestHandler, type Response } from 'express';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
    applyInventoryMovement,
    InventoryError,
} from '../services/inventory.service';
import {
    UUID_RE,
    readBody,
    readPage,
    onlyKeys,
    prismaErrorCode,
} from '../utils/admin-api';

type Actor = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    branchId: string | null;
};

type CountLine = {
    ingredientId: string;
    countedQuantity: string;
};

class CountError extends Error {
    constructor(
        message: string,
        public readonly status = 409
    ) {
        super(message);
    }
}

const txOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 30000,
};

const countSelect = {
    id: true,
    branchId: true,
    businessDate: true,
    shift: true,
    status: true,
    note: true,
    returnReason: true,
    createdById: true,
    approvedById: true,
    submittedAt: true,
    approvedAt: true,
    createdAt: true,
    updatedAt: true,
    items: {
        select: {
            ingredientId: true,
            countedQuantity: true,
            expectedQuantity: true,
            variance: true,
        },
        orderBy: { ingredientId: 'asc' },
    },
} as const;

function actorOf(res: Response): Actor {
    return res.locals.authUser as Actor;
}

function scope(actor: Actor) {
    return actor.role === 'ADMIN'
        ? {}
        : { branchId: actor.branchId! };
}

function resolveBranch(
    actor: Actor,
    value: unknown
): string | null {
    if (actor.role === 'ADMIN') {
        return typeof value === 'string' && UUID_RE.test(value)
            ? value.toLowerCase()
            : null;
    }

    if (!actor.branchId) return null;

    if (value !== undefined) {
        if (
            typeof value !== 'string' ||
            !UUID_RE.test(value) ||
            value.toLowerCase() !== actor.branchId
        ) {
            return null;
        }
    }

    return actor.branchId;
}

function parseDate(value: unknown): Date | null {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        return null;
    }

    return date;
}

function parseNote(
    value: unknown
): string | null | undefined | false {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return false;

    const note = value.trim();
    return note.length <= 500 ? (note || null) : false;
}

function parseLines(value: unknown): CountLine[] | null {
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 500
    ) {
        return null;
    }

    const result: CountLine[] = [];
    const ids = new Set<string>();

    for (const raw of value) {
        const item = readBody(raw);

        if (
            !item ||
            !onlyKeys(item, ['ingredientId', 'countedQuantity'])
        ) {
            return null;
        }

        const id = item.ingredientId;
        const qty = item.countedQuantity;

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            typeof qty !== 'string' ||
            !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(qty)
        ) {
            return null;
        }

        const ingredientId = id.toLowerCase();

        if (ids.has(ingredientId)) return null;

        ids.add(ingredientId);
        result.push({
            ingredientId,
            countedQuantity: qty,
        });
    }

    return result;
}

// A shift count must cover every active ingredient
// and any inactive ingredient that still has stock.
async function validateCoverage(
    tx: Prisma.TransactionClient,
    branchId: string,
    lines: CountLine[]
) {
    const required = await tx.ingredient.findMany({
        where: {
            OR: [
                { isActive: true },
                {
                    inventoryBalances: {
                        some: {
                            branchId,
                            quantity: { gt: 0 },
                        },
                    },
                },
            ],
        },
        select: {
            id: true,
            unit: true,
        },
    });

    if (
        required.length < 1 ||
        required.length > 500 ||
        required.length !== lines.length
    ) {
        throw new CountError(
            'Count must include all tracked ingredients',
            400
        );
    }

    const input = new Map(
        lines.map(line => [
            line.ingredientId,
            new Prisma.Decimal(line.countedQuantity),
        ])
    );

    for (const ingredient of required) {
        const quantity = input.get(ingredient.id);

        if (quantity === undefined) {
            throw new CountError(
                'Missing ingredient in stock count',
                400
            );
        }

        if (
            ingredient.unit === 'piece' &&
            !quantity.isInteger()
        ) {
            throw new CountError(
                'Piece quantity must be a whole number',
                400
            );
        }
    }
}

function sendError(res: Response, error: unknown) {
    if (
        error instanceof CountError ||
        error instanceof InventoryError
    ) {
        res.status(error.status).json({
            error: error.message,
        });
        return;
    }

    const code = prismaErrorCode(error);

    if (code === 'P2002' || code === 'P2034') {
        res.status(409).json({
            error: 'Stock count conflict. Please refresh and retry.',
        });
        return;
    }

    if (code === 'P2003') {
        res.status(409).json({
            error: 'Related record is unavailable',
        });
        return;
    }

    res.status(503).json({
        error: 'Stock count database unavailable',
    });
}

const requireApprover: RequestHandler = (_req, res, next) => {
    const actor = res.locals.authUser as Actor | undefined;

    if (
        !actor ||
        (
            actor.role !== 'ADMIN' &&
            actor.role !== 'BRANCH_MANAGER'
        )
    ) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    next();
};

export function createShiftStockCountRouter(
    prisma: PrismaClient
) {
    const router = Router();

    // GET /api/shift-stock-counts/template?branchId=...
    // Returns the ingredient list for the counting form.
    router.get('/template', async (req, res) => {
        const branchId = resolveBranch(
            actorOf(res),
            req.query.branchId
        );

        if (!branchId) {
            res.status(400).json({ error: 'Invalid branch' });
            return;
        }

        try {
            const ingredients = await prisma.ingredient.findMany({
                where: {
                    OR: [
                        { isActive: true },
                        {
                            inventoryBalances: {
                                some: {
                                    branchId,
                                    quantity: { gt: 0 },
                                },
                            },
                        },
                    ],
                },
                select: {
                    id: true,
                    code: true,
                    name: true,
                    unit: true,
                    inventoryBalances: {
                        where: { branchId },
                        select: { quantity: true },
                    },
                },
                orderBy: { code: 'asc' },
            });

            res.json({
                branchId,
                items: ingredients.map(item => ({
                    ingredientId: item.id,
                    code: item.code,
                    name: item.name,
                    unit: item.unit,
                    systemQuantity:
                        item.inventoryBalances[0]?.quantity ?? '0',
                })),
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET /api/shift-stock-counts
    router.get('/', async (req, res) => {
        const actor = actorOf(res);
        const page = readPage(req.query.page);
        const filter = req.query.branchId;

        if (
            page === null ||
            (
                filter !== undefined &&
                (
                    typeof filter !== 'string' ||
                    !UUID_RE.test(filter)
                )
            )
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        if (
            actor.role !== 'ADMIN' &&
            filter !== undefined &&
            filter.toLowerCase() !== actor.branchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const where = {
            ...scope(actor),
            ...(
                actor.role === 'ADMIN' &&
                    typeof filter === 'string'
                    ? { branchId: filter.toLowerCase() }
                    : {}
            ),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.shiftStockCount.count({ where }),
                prisma.shiftStockCount.findMany({
                    where,
                    select: {
                        id: true,
                        branchId: true,
                        businessDate: true,
                        shift: true,
                        status: true,
                        createdById: true,
                        createdAt: true,
                        approvedAt: true,
                    },
                    orderBy: [
                        { businessDate: 'desc' },
                        { createdAt: 'desc' },
                    ],
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, page, total });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET /api/shift-stock-counts/:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid count ID' });
            return;
        }

        try {
            const record = await prisma.shiftStockCount.findFirst({
                where: { id, ...scope(actorOf(res)) },
                select: countSelect,
            });

            if (!record) {
                res.status(404).json({ error: 'Count not found' });
                return;
            }

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /api/shift-stock-counts
    // STAFF may create a draft for their own branch.
    router.post('/', async (req, res) => {
        const body = readBody(req.body);

        if (
            !body ||
            !onlyKeys(body, [
                'branchId',
                'businessDate',
                'shift',
                'note',
                'items',
            ])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const actor = actorOf(res);
        const branchId = resolveBranch(actor, body.branchId);
        const date = parseDate(body.businessDate);
        const shift = body.shift;
        const note = parseNote(body.note);
        const items = parseLines(body.items);

        if (
            !branchId ||
            !date ||
            (
                shift !== 'MORNING' &&
                shift !== 'AFTERNOON' &&
                shift !== 'EVENING'
            ) ||
            note === false ||
            !items
        ) {
            res.status(400).json({
                error: 'Invalid stock count data',
            });
            return;
        }

        try {
            const record = await prisma.$transaction(async tx => {
                const branch = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { isActive: true },
                });

                if (!branch?.isActive) {
                    throw new CountError('Branch unavailable');
                }

                await validateCoverage(tx, branchId, items);

                return tx.shiftStockCount.create({
                    data: {
                        branchId,
                        businessDate: date,
                        shift,
                        note: note ?? null,
                        createdById: actor.id,
                        status: 'DRAFT',
                        items: {
                            create: items,
                        },
                    },
                    select: countSelect,
                });
            }, txOptions);

            res.status(201).json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // PATCH /:id - Edit DRAFT or RETURNED.
    router.patch('/:id', async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            Object.keys(body).length === 0 ||
            !onlyKeys(body, ['note', 'items'])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const note = parseNote(body.note);
        const items = body.items === undefined
            ? undefined
            : parseLines(body.items);

        if (note === false || items === null) {
            res.status(400).json({ error: 'Invalid count data' });
            return;
        }

        const actor = actorOf(res);

        try {
            const record = await prisma.$transaction(async tx => {
                const existing = await tx.shiftStockCount.findFirst({
                    where: {
                        id,
                        ...scope(actor),
                        status: { in: ['DRAFT', 'RETURNED'] },
                    },
                    select: { branchId: true },
                });

                if (!existing) {
                    throw new CountError(
                        'Count unavailable for editing'
                    );
                }

                if (items) {
                    await validateCoverage(
                        tx,
                        existing.branchId,
                        items
                    );
                }

                const changed = await tx.shiftStockCount.updateMany({
                    where: {
                        id,
                        status: { in: ['DRAFT', 'RETURNED'] },
                        ...scope(actor),
                    },
                    data: {
                        updatedAt: new Date(),
                        ...(note !== undefined ? { note } : {}),
                    },
                });

                if (changed.count !== 1) {
                    throw new CountError('Count changed concurrently');
                }

                if (items) {
                    await tx.shiftStockCountItem.deleteMany({
                        where: { countId: id },
                    });

                    await tx.shiftStockCountItem.createMany({
                        data: items.map(item => ({
                            countId: id,
                            ...item,
                        })),
                    });
                }

                return tx.shiftStockCount.findUnique({
                    where: { id },
                    select: countSelect,
                });
            }, txOptions);

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /:id/submit
    // Take a snapshot of the theoretical stock at submission.
    router.post('/:id/submit', async (req, res) => {
        const id = req.params.id;
        const actor = actorOf(res);

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid count ID' });
            return;
        }

        try {
            const record = await prisma.$transaction(async tx => {
                const current = await tx.shiftStockCount.findFirst({
                    where: {
                        id,
                        ...scope(actor),
                        status: { in: ['DRAFT', 'RETURNED'] },
                    },
                    select: {
                        branchId: true,
                        items: {
                            select: {
                                ingredientId: true,
                                countedQuantity: true,
                            },
                        },
                    },
                });

                if (!current) {
                    throw new CountError(
                        'Count is not ready for submission'
                    );
                }

                const lines: CountLine[] = current.items.map(item => ({
                    ingredientId: item.ingredientId,
                    countedQuantity: item.countedQuantity.toFixed(6),
                }));

                await validateCoverage(
                    tx,
                    current.branchId,
                    lines
                );

                const balances = await tx.inventoryBalance.findMany({
                    where: {
                        branchId: current.branchId,
                        ingredientId: {
                            in: lines.map(line => line.ingredientId),
                        },
                    },
                    select: {
                        ingredientId: true,
                        quantity: true,
                    },
                });

                const balanceMap = new Map(
                    balances.map(item => [
                        item.ingredientId,
                        item.quantity,
                    ])
                );

                const changed = await tx.shiftStockCount.updateMany({
                    where: {
                        id,
                        ...scope(actor),
                        status: { in: ['DRAFT', 'RETURNED'] },
                    },
                    data: {
                        status: 'SUBMITTED',
                        submittedAt: new Date(),
                        returnReason: null,
                    },
                });

                if (changed.count !== 1) {
                    throw new CountError('Count changed concurrently');
                }

                await tx.shiftStockCountItem.deleteMany({
                    where: { countId: id },
                });

                await tx.shiftStockCountItem.createMany({
                    data: lines.map(line => {
                        const expected =
                            balanceMap.get(line.ingredientId) ??
                            new Prisma.Decimal(0);

                        const actual = new Prisma.Decimal(
                            line.countedQuantity
                        );

                        return {
                            countId: id,
                            ingredientId: line.ingredientId,
                            countedQuantity: actual,
                            expectedQuantity: expected,
                            variance: actual.minus(expected),
                        };
                    }),
                });

                return tx.shiftStockCount.findUnique({
                    where: { id },
                    select: countSelect,
                });
            }, txOptions);

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /:id/return
    // Manager sends a submitted count back for correction.
    router.post('/:id/return', requireApprover, async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);
        const reason = body?.reason;

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            !onlyKeys(body, ['reason']) ||
            typeof reason !== 'string' ||
            reason.trim().length < 1 ||
            reason.trim().length > 500
        ) {
            res.status(400).json({ error: 'Invalid return request' });
            return;
        }

        const actor = actorOf(res);

        try {
            const record = await prisma.$transaction(async tx => {
                const changed = await tx.shiftStockCount.updateMany({
                    where: {
                        id,
                        status: 'SUBMITTED',
                        ...scope(actor),
                    },
                    data: {
                        status: 'RETURNED',
                        returnReason: reason.trim(),
                        submittedAt: null,
                    },
                });

                if (changed.count !== 1) {
                    throw new CountError(
                        'Count is not pending approval'
                    );
                }

                await tx.shiftStockCountItem.updateMany({
                    where: { countId: id },
                    data: {
                        expectedQuantity: null,
                        variance: null,
                    },
                });

                return tx.shiftStockCount.findUnique({
                    where: { id },
                    select: countSelect,
                });
            }, txOptions);

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /:id/approve
    // Approval and inventory adjustments are atomic.
    router.post('/:id/approve', requireApprover, async (req, res) => {
        const id = req.params.id;
        const actor = actorOf(res);

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid count ID' });
            return;
        }

        try {
            const record = await prisma.$transaction(async tx => {
                const current = await tx.shiftStockCount.findFirst({
                    where: {
                        id,
                        status: 'SUBMITTED',
                        ...scope(actor),
                    },
                    select: {
                        branchId: true,
                        submittedAt: true,
                        items: {
                            select: {
                                ingredientId: true,
                                countedQuantity: true,
                                expectedQuantity: true,
                                variance: true,
                            },
                            orderBy: { ingredientId: 'asc' },
                        },
                    },
                });

                if (
                    !current ||
                    !current.submittedAt ||
                    current.items.length === 0
                ) {
                    throw new CountError(
                        'Count is not pending approval'
                    );
                }

                // No incoming/outgoing stock movement is allowed
                // after the count snapshot was submitted.
                const newerMovements = await tx.inventoryMovement.count({
                    where: {
                        branchId: current.branchId,
                        createdAt: {
                            gt: current.submittedAt,
                        },
                    },
                });

                if (newerMovements > 0) {
                    throw new CountError(
                        'Inventory changed. Return the count for recounting.'
                    );
                }

                const balances = await tx.inventoryBalance.findMany({
                    where: {
                        branchId: current.branchId,
                        ingredientId: {
                            in: current.items.map(item => item.ingredientId),
                        },
                    },
                    select: {
                        ingredientId: true,
                        quantity: true,
                    },
                });

                const map = new Map(
                    balances.map(item => [
                        item.ingredientId,
                        item.quantity,
                    ])
                );

                for (const item of current.items) {
                    if (
                        item.expectedQuantity === null ||
                        item.variance === null
                    ) {
                        throw new CountError(
                            'Incomplete count snapshot'
                        );
                    }

                    const now = map.get(item.ingredientId) ??
                        new Prisma.Decimal(0);

                    if (!now.eq(item.expectedQuantity)) {
                        throw new CountError(
                            'Inventory changed. Return the count for recounting.'
                        );
                    }
                }

                const changed = await tx.shiftStockCount.updateMany({
                    where: {
                        id,
                        status: 'SUBMITTED',
                        ...scope(actor),
                    },
                    data: {
                        status: 'APPROVED',
                        approvedById: actor.id,
                        approvedAt: new Date(),
                    },
                });

                if (changed.count !== 1) {
                    throw new CountError('Count changed concurrently');
                }

                for (const item of current.items) {
                    const delta = item.variance!;

                    if (delta.isZero()) continue;

                    await applyInventoryMovement(tx, {
                        branchId: current.branchId,
                        ingredientId: item.ingredientId,
                        actorId: actor.id,
                        sourceId: id,
                        kind: 'COUNT_ADJUSTMENT',
                        delta: delta.toFixed(6),
                    });
                }

                return tx.shiftStockCount.findUnique({
                    where: { id },
                    select: countSelect,
                });
            }, txOptions);

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
