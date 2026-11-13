
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

type ReceiptLine = {
    ingredientId: string;
    quantity: string;
    unitCost: string;
};

class ReceiptError extends Error {
    constructor(message: string, public readonly status = 409) {
        super(message);
    }
}

const transactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 30000,
};

const receiptSelect = {
    id: true,
    code: true,
    branchId: true,
    supplierName: true,
    note: true,
    status: true,
    createdById: true,
    postedById: true,
    postedAt: true,
    createdAt: true,
    updatedAt: true,
    items: {
        select: {
            id: true,
            ingredientId: true,
            quantity: true,
            unitCost: true,
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

function nullableText(
    value: unknown,
    maxLength: number
): string | null | undefined | false {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return false;

    const text = value.trim();
    return text.length <= maxLength ? (text || null) : false;
}

function parseItems(value: unknown): ReceiptLine[] | null {
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 50
    ) {
        return null;
    }

    const result: ReceiptLine[] = [];
    const seen = new Set<string>();

    for (const raw of value) {
        const item = readBody(raw);

        if (!item || !onlyKeys(item, [
            'ingredientId',
            'quantity',
            'unitCost',
        ])) {
            return null;
        }

        const ingredientId = item.ingredientId;
        const quantity = item.quantity;
        const unitCost = item.unitCost;

        if (
            typeof ingredientId !== 'string' ||
            !UUID_RE.test(ingredientId) ||
            typeof quantity !== 'string' ||
            !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(quantity) ||
            typeof unitCost !== 'string' ||
            !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(unitCost)
        ) {
            return null;
        }

        if (
            new Prisma.Decimal(quantity).lte(0) ||
            new Prisma.Decimal(unitCost).lt(0)
        ) {
            return null;
        }

        const normalizedId = ingredientId.toLowerCase();

        if (seen.has(normalizedId)) return null;

        seen.add(normalizedId);
        result.push({
            ingredientId: normalizedId,
            quantity,
            unitCost,
        });
    }

    return result;
}

function sendError(res: Response, error: unknown) {
    if (error instanceof ReceiptError || error instanceof InventoryError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    const code = prismaErrorCode(error);

    if (code === 'P2002') {
        res.status(409).json({ error: 'Duplicate receipt data' });
        return;
    }

    if (code === 'P2034') {
        res.status(409).json({
            error: 'Concurrent update. Please retry.',
        });
        return;
    }

    res.status(503).json({ error: 'Receipt database unavailable' });
}

const requireReceiptWriter: RequestHandler = (_req, res, next) => {
    const actor = res.locals.authUser as Actor | undefined;

    if (
        !actor ||
        (actor.role !== 'ADMIN' && actor.role !== 'BRANCH_MANAGER')
    ) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    next();
};

export function createGoodsReceiptRouter(prisma: PrismaClient) {
    const router = Router();

    // GET /api/goods-receipts
    router.get('/', async (req, res) => {
        const actor = actorOf(res);
        const page = readPage(req.query.page);
        const requestedBranch = req.query.branchId;

        if (
            page === null ||
            (requestedBranch !== undefined &&
                (typeof requestedBranch !== 'string' ||
                    !UUID_RE.test(requestedBranch)))
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        if (
            actor.role !== 'ADMIN' &&
            requestedBranch &&
            requestedBranch !== actor.branchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const where = {
            ...scope(actor),
            ...(actor.role === 'ADMIN' &&
                typeof requestedBranch === 'string'
                ? { branchId: requestedBranch }
                : {}),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.goodsReceipt.count({ where }),
                prisma.goodsReceipt.findMany({
                    where,
                    select: {
                        id: true,
                        code: true,
                        branchId: true,
                        supplierName: true,
                        status: true,
                        createdAt: true,
                        postedAt: true,
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' },
                    ],
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, total, page });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET /api/goods-receipts/:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid receipt ID' });
            return;
        }

        try {
            const receipt = await prisma.goodsReceipt.findFirst({
                where: { id, ...scope(actorOf(res)) },
                select: receiptSelect,
            });

            if (!receipt) {
                res.status(404).json({ error: 'Receipt not found' });
                return;
            }

            res.json({ data: receipt });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /api/goods-receipts
    router.post('/', requireReceiptWriter, async (req, res) => {
        const actor = actorOf(res);
        const body = readBody(req.body);

        if (!body || !onlyKeys(body, [
            'code', 'branchId', 'supplierName', 'note', 'items',
        ])) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const code = typeof body.code === 'string'
            ? body.code.trim().toUpperCase()
            : '';

        const branchId = body.branchId;
        const supplierName = nullableText(body.supplierName, 160);
        const note = nullableText(body.note, 500);
        const items = parseItems(body.items);

        if (
            !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) ||
            typeof branchId !== 'string' ||
            !UUID_RE.test(branchId) ||
            supplierName === false ||
            note === false ||
            !items
        ) {
            res.status(400).json({ error: 'Invalid receipt data' });
            return;
        }

        if (
            actor.role !== 'ADMIN' &&
            actor.branchId !== branchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        try {
            const receipt = await prisma.$transaction(async tx => {
                const branch = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { isActive: true },
                });

                if (!branch?.isActive) {
                    throw new ReceiptError('Inactive or unknown branch');
                }

                const activeIngredients = await tx.ingredient.count({
                    where: {
                        id: { in: items.map(item => item.ingredientId) },
                        isActive: true,
                    },
                });

                if (activeIngredients !== items.length) {
                    throw new ReceiptError('Ingredient unavailable');
                }

                return tx.goodsReceipt.create({
                    data: {
                        code,
                        branchId,
                        supplierName: supplierName ?? null,
                        note: note ?? null,
                        createdById: actor.id,
                        status: 'DRAFT',
                        items: { create: items },
                    },
                    select: receiptSelect,
                });
            }, transactionOptions);

            res.status(201).json({ data: receipt });
        } catch (error) {
            sendError(res, error);
        }
    });

    // PATCH /api/goods-receipts/:id - edit a DRAFT
    router.patch('/:id', requireReceiptWriter, async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            Object.keys(body).length === 0 ||
            !onlyKeys(body, ['supplierName', 'note', 'items'])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const supplierName = nullableText(body.supplierName, 160);
        const note = nullableText(body.note, 500);
        const items = body.items === undefined
            ? undefined
            : parseItems(body.items);

        if (
            supplierName === false ||
            note === false ||
            items === null
        ) {
            res.status(400).json({ error: 'Invalid receipt data' });
            return;
        }

        const actor = actorOf(res);

        try {
            const updated = await prisma.$transaction(async tx => {
                const receipt = await tx.goodsReceipt.findFirst({
                    where: { id, ...scope(actor) },
                    select: { status: true },
                });

                if (!receipt) {
                    throw new ReceiptError('Receipt not found', 404);
                }

                if (receipt.status !== 'DRAFT') {
                    throw new ReceiptError('Only DRAFT can be edited');
                }

                if (items) {
                    const count = await tx.ingredient.count({
                        where: {
                            id: { in: items.map(item => item.ingredientId) },
                            isActive: true,
                        },
                    });

                    if (count !== items.length) {
                        throw new ReceiptError('Ingredient unavailable');
                    }
                }

                const result = await tx.goodsReceipt.updateMany({
                    where: { id, status: 'DRAFT' },
                    data: {
                        updatedAt: new Date(),
                        ...(supplierName !== undefined
                            ? { supplierName } : {}),
                        ...(note !== undefined ? { note } : {}),
                    },
                });

                if (result.count !== 1) {
                    throw new ReceiptError('Receipt changed concurrently');
                }

                if (items) {
                    await tx.goodsReceiptItem.deleteMany({
                        where: { receiptId: id },
                    });

                    await tx.goodsReceiptItem.createMany({
                        data: items.map(item => ({
                            receiptId: id,
                            ...item,
                        })),
                    });
                }

                return tx.goodsReceipt.findUnique({
                    where: { id },
                    select: receiptSelect,
                });
            }, transactionOptions);

            res.json({ data: updated });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /api/goods-receipts/:id/post
    router.post('/:id/post', requireReceiptWriter, async (req, res) => {
        const id = req.params.id;
        const actor = actorOf(res);

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid receipt ID' });
            return;
        }

        try {
            const posted = await prisma.$transaction(async tx => {
                const receipt = await tx.goodsReceipt.findFirst({
                    where: { id, ...scope(actor) },
                    select: { branchId: true, status: true },
                });

                if (!receipt) {
                    throw new ReceiptError('Receipt not found', 404);
                }

                if (receipt.status !== 'DRAFT') {
                    throw new ReceiptError('Receipt is not DRAFT');
                }

                const result = await tx.goodsReceipt.updateMany({
                    where: { id, status: 'DRAFT' },
                    data: {
                        status: 'POSTED',
                        postedById: actor.id,
                        postedAt: new Date(),
                    },
                });

                if (result.count !== 1) {
                    throw new ReceiptError('Receipt changed concurrently');
                }

                const items = await tx.goodsReceiptItem.findMany({
                    where: { receiptId: id },
                    orderBy: { ingredientId: 'asc' },
                    select: { ingredientId: true, quantity: true },
                });

                if (items.length === 0) {
                    throw new ReceiptError('Receipt has no items');
                }

                for (const item of items) {
                    await applyInventoryMovement(tx, {
                        branchId: receipt.branchId,
                        ingredientId: item.ingredientId,
                        actorId: actor.id,
                        sourceId: id,
                        kind: 'RECEIPT',
                        delta: item.quantity.toFixed(6),
                    });
                }

                return tx.goodsReceipt.findUnique({
                    where: { id },
                    select: receiptSelect,
                });
            }, transactionOptions);

            res.json({ data: posted });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /api/goods-receipts/:id/cancel
    router.post('/:id/cancel', requireReceiptWriter, async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid receipt ID' });
            return;
        }

        try {
            const result = await prisma.goodsReceipt.updateMany({
                where: {
                    id,
                    status: 'DRAFT',
                    ...scope(actorOf(res)),
                },
                data: { status: 'CANCELLED' },
            });

            if (result.count !== 1) {
                res.status(409).json({
                    error: 'Receipt missing or not DRAFT',
                });
                return;
            }

            res.json({ status: 'CANCELLED' });
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
