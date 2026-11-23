
import { Router, type RequestHandler, type Response } from 'express';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createStockTransferReceiptRouter } from './transfer-receipt.routes';
import { lockReceivingBranches, ReceivingGuardError, isReceivingTransactionConflict } from '../services/receiving-guard.service';
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

type Kind = 'ISSUE' | 'TRANSFER';

type Actor = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    branchId: string | null;
};

type Line = {
    ingredientId: string;
    quantity: string;
};

class StockDocumentError extends Error {
    constructor(message: string, public readonly status = 409) {
        super(message);
    }
}

const txOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 30000,
};

const documentSelect = {
    id: true,
    code: true,
    type: true,
    status: true,
    sourceBranchId: true,
    destinationBranchId: true,
    note: true,
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
        },
        orderBy: { ingredientId: 'asc' },
    },
} as const;

function actorOf(res: Response): Actor {
    return res.locals.authUser as Actor;
}

function readableScope(actor: Actor, kind: Kind) {
    if (actor.role === 'ADMIN') return {};

    if (kind === 'TRANSFER') {
        return {
            OR: [
                { sourceBranchId: actor.branchId! },
                { destinationBranchId: actor.branchId! },
            ],
        };
    }

    return { sourceBranchId: actor.branchId! };
}

function writableScope(actor: Actor) {
    return actor.role === 'ADMIN'
        ? {}
        : { sourceBranchId: actor.branchId! };
}

function parseLines(value: unknown): Line[] | null {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
        return null;
    }

    const result: Line[] = [];
    const seen = new Set<string>();

    for (const raw of value) {
        const item = readBody(raw);

        if (!item || !onlyKeys(item, ['ingredientId', 'quantity'])) {
            return null;
        }

        const ingredientId = item.ingredientId;
        const quantity = item.quantity;

        if (
            typeof ingredientId !== 'string' ||
            !UUID_RE.test(ingredientId) ||
            typeof quantity !== 'string' ||
            !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(quantity) ||
            new Prisma.Decimal(quantity).lte(0)
        ) {
            return null;
        }

        const id = ingredientId.toLowerCase();

        if (seen.has(id)) return null;

        seen.add(id);
        result.push({ ingredientId: id, quantity });
    }

    return result;
}

async function validateIngredients(
    tx: Prisma.TransactionClient,
    items: Line[],
    kind: Kind
) {
    const ingredients = await tx.ingredient.findMany({
        where: {
            id: { in: items.map(item => item.ingredientId) },
            isActive: true,
        },
        select: { id: true, unit: true },
    });

    if (ingredients.length !== items.length) {
        throw new StockDocumentError('Ingredient unavailable');
    }

    if (kind === 'TRANSFER') {
        const units = new Map(ingredients.map(ingredient => [ingredient.id, ingredient.unit]));
        if (items.some(item =>
            units.get(item.ingredientId) === 'piece' &&
            !new Prisma.Decimal(item.quantity).isInteger()
        )) {
            throw new StockDocumentError('Piece quantities must be whole numbers', 400);
        }
    }
}

function parseNote(value: unknown): string | null | undefined | false {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return false;

    const text = value.trim();
    return text.length <= 500 ? (text || null) : false;
}

function sendError(res: Response, error: unknown) {
    if (error instanceof ReceivingGuardError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
    }
    if (
        error instanceof StockDocumentError ||
        error instanceof InventoryError
    ) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    const code = prismaErrorCode(error);

    if (code === 'P2002' || code === 'P2003') {
        res.status(409).json({ error: 'Stock document conflict' });
        return;
    }

    if (isReceivingTransactionConflict(error)) {
        res.status(409).json({
            error: 'Concurrent inventory update. Please retry.',
        });
        return;
    }

    res.status(503).json({ error: 'Stock database unavailable' });
}

export function createStockDocumentRouter(
    prisma: PrismaClient,
    kind: Kind
) {
    const router = Router();
    if (kind === 'TRANSFER') router.use(createStockTransferReceiptRouter(prisma));

    // Transfers require ADMIN to perform writes.
    // Issues can also be managed by the branch manager.
    const requireWriter: RequestHandler = (_req, res, next) => {
        const actor = res.locals.authUser as Actor | undefined;

        const allowed = actor?.role === 'ADMIN' ||
            (kind === 'ISSUE' && actor?.role === 'BRANCH_MANAGER');

        if (!allowed) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        next();
    };

    // GET /api/stock-issues or /api/stock-transfers
    router.get('/', async (req, res) => {
        const actor = actorOf(res);
        const page = readPage(req.query.page);
        const filter = req.query.sourceBranchId;
        const destination = req.query.destinationBranchId;
        const status = req.query.status;
        const requestedCode = req.query.code;

        if (
            page === null ||
            (filter !== undefined &&
                (typeof filter !== 'string' || !UUID_RE.test(filter))) ||
            (destination !== undefined && (kind !== 'TRANSFER' || typeof destination !== 'string' || !UUID_RE.test(destination))) ||
            (status !== undefined && status !== 'DRAFT' && status !== 'POSTED' && status !== 'CANCELLED') ||
            (requestedCode !== undefined && (typeof requestedCode !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(requestedCode)))
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        if (filter !== undefined && actor.role !== 'ADMIN') {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        if (typeof destination === 'string' && actor.role !== 'ADMIN' && destination.toLowerCase() !== actor.branchId) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const where: Prisma.StockDocumentWhereInput = {
            type: kind,
            ...readableScope(actor, kind),
            ...(typeof filter === 'string'
                ? { sourceBranchId: filter }
                : {}),
            ...(typeof destination === 'string' ? { destinationBranchId: destination.toLowerCase() } : {}),
            ...(status === 'DRAFT' || status === 'POSTED' || status === 'CANCELLED' ? { status } : {}),
            ...(typeof requestedCode === 'string' ? { code: requestedCode } : {}),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.stockDocument.count({ where }),
                prisma.stockDocument.findMany({
                    where,
                    select: {
                        id: true,
                        code: true,
                        type: true,
                        status: true,
                        sourceBranchId: true,
                        destinationBranchId: true,
                        createdAt: true,
                        postedAt: true,
                        legacyReceivingRequired: true,
                        transferReceipt: { select: { id: true, status: true, version: true, confirmedAt: true } },
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

    // GET /:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid document ID' });
            return;
        }

        const actor = actorOf(res);

        try {
            const document = await prisma.stockDocument.findFirst({
                where: {
                    id,
                    type: kind,
                    ...readableScope(actor, kind),
                },
                select: documentSelect,
            });

            if (!document) {
                res.status(404).json({ error: 'Document not found' });
                return;
            }

            res.json({ data: document });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST / - Create a DRAFT
    router.post('/', requireWriter, async (req, res) => {
        const body = readBody(req.body);

        if (!body || !onlyKeys(body, [
            'code',
            'sourceBranchId',
            'destinationBranchId',
            'note',
            'items',
        ])) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const code = typeof body.code === 'string'
            ? body.code.trim().toUpperCase()
            : '';

        const sourceValue = body.sourceBranchId;
        const destinationValue = body.destinationBranchId;
        const note = parseNote(body.note);
        const items = parseLines(body.items);

        if (
            !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) ||
            typeof sourceValue !== 'string' ||
            !UUID_RE.test(sourceValue) ||
            note === false ||
            !items
        ) {
            res.status(400).json({ error: 'Invalid document data' });
            return;
        }

        const sourceBranchId = sourceValue.toLowerCase();
        let destinationBranchId: string | null = null;

        if (kind === 'TRANSFER') {
            if (
                typeof destinationValue !== 'string' ||
                !UUID_RE.test(destinationValue)
            ) {
                res.status(400).json({ error: 'Invalid destination' });
                return;
            }

            destinationBranchId = destinationValue.toLowerCase();

            if (destinationBranchId === sourceBranchId) {
                res.status(400).json({
                    error: 'Source and destination must differ',
                });
                return;
            }
        } else if (
            destinationValue !== undefined &&
            destinationValue !== null
        ) {
            res.status(400).json({
                error: 'Issue must not have a destination',
            });
            return;
        }

        const actor = actorOf(res);

        if (
            actor.role !== 'ADMIN' &&
            actor.branchId !== sourceBranchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        try {
            const document = await prisma.$transaction(async tx => {
                const branchIds = [
                    sourceBranchId,
                    ...(destinationBranchId ? [destinationBranchId] : []),
                ];

                const activeBranches = await tx.branch.count({
                    where: {
                        id: { in: branchIds },
                        isActive: true,
                    },
                });

                if (activeBranches !== branchIds.length) {
                    throw new StockDocumentError('Branch unavailable');
                }

                await validateIngredients(tx, items, kind);

                return tx.stockDocument.create({
                    data: {
                        code,
                        type: kind,
                        status: 'DRAFT',
                        sourceBranchId,
                        destinationBranchId,
                        note: note ?? null,
                        createdById: actor.id,
                        items: { create: items },
                    },
                    select: documentSelect,
                });
            }, txOptions);

            res.status(201).json({ data: document });
        } catch (error) {
            sendError(res, error);
        }
    });

    // PATCH /:id - Only DRAFT documents can be edited.
    router.patch('/:id', requireWriter, async (req, res) => {
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
            res.status(400).json({ error: 'Invalid document data' });
            return;
        }

        const actor = actorOf(res);

        try {
            const updated = await prisma.$transaction(async tx => {
                const existing = await tx.stockDocument.findFirst({
                    where: {
                        id,
                        type: kind,
                        ...writableScope(actor),
                    },
                    select: { status: true },
                });

                if (!existing) {
                    throw new StockDocumentError('Document not found', 404);
                }

                if (existing.status !== 'DRAFT') {
                    throw new StockDocumentError('Only DRAFT can be edited');
                }

                if (items) {
                    await validateIngredients(tx, items, kind);
                }

                const changed = await tx.stockDocument.updateMany({
                    where: {
                        id,
                        type: kind,
                        status: 'DRAFT',
                        ...writableScope(actor),
                    },
                    data: {
                        updatedAt: new Date(),
                        ...(note !== undefined ? { note } : {}),
                    },
                });

                if (changed.count !== 1) {
                    throw new StockDocumentError('Document changed concurrently');
                }

                if (items) {
                    await tx.stockDocumentItem.deleteMany({
                        where: { documentId: id },
                    });

                    await tx.stockDocumentItem.createMany({
                        data: items.map(item => ({
                            documentId: id,
                            ...item,
                        })),
                    });
                }

                return tx.stockDocument.findUnique({
                    where: { id },
                    select: documentSelect,
                });
            }, txOptions);

            res.json({ data: updated });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /:id/post - Confirm and update inventory.
    router.post('/:id/post', requireWriter, async (req, res) => {
        const id = req.params.id;
        const actor = actorOf(res);

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid document ID' });
            return;
        }

        try {
            const posted = await prisma.$transaction(async tx => {
                const document = await tx.stockDocument.findFirst({
                    where: {
                        id,
                        type: kind,
                        ...writableScope(actor),
                    },
                    select: {
                        status: true,
                        sourceBranchId: true,
                        destinationBranchId: true,
                        items: {
                            select: {
                                ingredientId: true,
                                quantity: true,
                            },
                            orderBy: { ingredientId: 'asc' },
                        },
                    },
                });

                if (!document) {
                    throw new StockDocumentError('Document not found', 404);
                }

                if (document.status !== 'DRAFT') {
                    throw new StockDocumentError('Document is not DRAFT');
                }

                if (document.items.length === 0) {
                    throw new StockDocumentError('Document has no items');
                }

                const branchIds = [
                    document.sourceBranchId,
                    ...(document.destinationBranchId
                        ? [document.destinationBranchId]
                        : []),
                ];

                // Shares a branch write barrier with receiving confirmation and B6.
                // B5 still posts source/destination movements in this same transaction.
                await lockReceivingBranches(tx, branchIds);

                const activeBranches = await tx.branch.count({
                    where: {
                        id: { in: branchIds },
                        isActive: true,
                    },
                });

                if (activeBranches !== branchIds.length) {
                    throw new StockDocumentError('Branch unavailable');
                }

                const activeIngredients = await tx.ingredient.count({
                    where: {
                        id: {
                            in: document.items.map(item => item.ingredientId),
                        },
                        isActive: true,
                    },
                });

                if (activeIngredients !== document.items.length) {
                    throw new StockDocumentError('Ingredient unavailable');
                }

                const changed = await tx.stockDocument.updateMany({
                    where: {
                        id,
                        type: kind,
                        status: 'DRAFT',
                        ...writableScope(actor),
                    },
                    data: {
                        status: 'POSTED',
                        postedById: actor.id,
                        postedAt: new Date(),
                    },
                });

                if (changed.count !== 1) {
                    throw new StockDocumentError('Document changed concurrently');
                }

                for (const item of document.items) {
                    const quantity = item.quantity.toFixed(6);

                    // ISSUE and TRANSFER both decrease source inventory.
                    await applyInventoryMovement(tx, {
                        branchId: document.sourceBranchId,
                        ingredientId: item.ingredientId,
                        actorId: actor.id,
                        sourceId: id,
                        kind: kind === 'ISSUE' ? 'ISSUE' : 'TRANSFER_OUT',
                        delta: `-${quantity}`,
                    });

                    if (kind === 'TRANSFER') {
                        const destinationBranchId =
                            document.destinationBranchId;

                        if (!destinationBranchId) {
                            throw new StockDocumentError(
                                'Missing transfer destination'
                            );
                        }

                        // Increase destination inventory in the SAME transaction.
                        await applyInventoryMovement(tx, {
                            branchId: destinationBranchId,
                            ingredientId: item.ingredientId,
                            actorId: actor.id,
                            sourceId: id,
                            kind: 'TRANSFER_IN',
                            delta: quantity,
                        });
                    }
                }

                return tx.stockDocument.findUnique({
                    where: { id },
                    select: documentSelect,
                });
            }, txOptions);

            res.json({ data: posted });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /:id/cancel - Cancel an unposted DRAFT.
    router.post('/:id/cancel', requireWriter, async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid document ID' });
            return;
        }

        try {
            const changed = await prisma.stockDocument.updateMany({
                where: {
                    id,
                    type: kind,
                    status: 'DRAFT',
                    ...writableScope(actorOf(res)),
                },
                data: { status: 'CANCELLED' },
            });

            if (changed.count !== 1) {
                res.status(409).json({
                    error: 'Document missing or not DRAFT',
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
