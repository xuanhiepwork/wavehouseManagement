import { Router, type Response } from 'express';
import { onlyKeys, prismaErrorCode, readPage, UUID_RE } from '../utils/admin-api';
import type { PrismaClient } from '../generated/prisma/client';
import { createTransferReceiptService, parseReceivingInput, TransferReceiptError, type ReceivingActor } from '../services/transfer-receipt.service';
import { ReceivingGuardError, isReceivingTransactionConflict } from '../services/receiving-guard.service';

function actorOf(res: Response): ReceivingActor { return res.locals.authUser as ReceivingActor; }
function errorResponse(res: Response, error: unknown) {
    if (error instanceof TransferReceiptError || error instanceof ReceivingGuardError) {
        res.status(error.status).json({ error: error.message, code: error.code });
    } else if (isReceivingTransactionConflict(error)) {
        res.status(409).json({ error: 'Concurrent receiving update. Reload and retry.', code: 'RECEIVING_CONFLICT' });
    } else if (['P2002', 'P2003', 'P2025', 'P2004'].includes(prismaErrorCode(error) ?? '')) {
        res.status(409).json({ error: 'Receiving data changed or conflicts. Reload before retrying.', code: 'RECEIVING_CONFLICT' });
    } else {
        res.status(503).json({ error: 'Receiving database unavailable' });
    }
}
function receivingRouter() {
    const router = Router();
    router.use((_req, res, next) => {
        const actor = actorOf(res);
        if (!actor) { res.status(401).json({ error: 'Unauthorized' }); return; }
        if (!['ADMIN', 'BRANCH_MANAGER', 'STAFF'].includes(actor.role) || (actor.role !== 'ADMIN' && !actor.branchId)) {
            res.status(403).json({ error: 'Forbidden' }); return;
        }
        next();
    });
    return router;
}
function idOf(value: unknown): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new TransferReceiptError('Invalid ID', 400, 'INVALID_ID');
    return value.toLowerCase();
}

export function createStockTransferReceiptRouter(prisma: PrismaClient) {
    const router = receivingRouter();
    const service = createTransferReceiptService(prisma);
    router.get('/:id/receipt', async (req, res) => {
        try { res.json({ data: await service.get(actorOf(res), idOf(req.params.id)) }); }
        catch (error) { errorResponse(res, error); }
    });
    router.post('/:id/receipt', async (req, res) => {
        try {
            const result = await service.create(actorOf(res), idOf(req.params.id), parseReceivingInput(req.body, 'create'));
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) { errorResponse(res, error); }
    });
    return router;
}

export function createTransferReceiptRouter(prisma: PrismaClient) {
    const router = receivingRouter();
    const service = createTransferReceiptService(prisma);
    router.get('/', async (req, res) => {
        try {
            const page = readPage(req.query.page);
            if (!page || !onlyKeys(req.query, ['page', 'destinationBranchId', 'status'])) {
                throw new TransferReceiptError('Invalid receiving query', 400, 'INVALID_QUERY');
            }
            const destinationBranchId = req.query.destinationBranchId === undefined ? undefined : idOf(req.query.destinationBranchId);
            const status = req.query.status;
            if (status !== undefined && status !== 'DRAFT' && status !== 'CONFIRMED') {
                throw new TransferReceiptError('Invalid receiving status', 400, 'INVALID_QUERY');
            }
            const actor = actorOf(res);
            if (actor.role !== 'ADMIN' && destinationBranchId && destinationBranchId !== actor.branchId) {
                res.status(403).json({ error: 'Forbidden' }); return;
            }
            res.json(await service.list(actor, { page,
                ...(destinationBranchId ? { destinationBranchId } : {}), ...(status ? { status } : {}) }));
        } catch (error) { errorResponse(res, error); }
    });
    router.patch('/:id', async (req, res) => {
        try { res.json({ data: await service.update(actorOf(res), idOf(req.params.id), parseReceivingInput(req.body, 'update')) }); }
        catch (error) { errorResponse(res, error); }
    });
    router.post('/:id/confirm', async (req, res) => {
        try {
            const input = parseReceivingInput(req.body, 'confirm');
            res.json(await service.confirm(actorOf(res), idOf(req.params.id), input.expectedVersion!));
        } catch (error) { errorResponse(res, error); }
    });
    return router;
}
