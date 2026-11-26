import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { onlyKeys, prismaErrorCode, readBody, readPage } from '../utils/admin-api';
import { createSalesReportService, parseSalesInput, SalesReportError, salesDate, salesId, salesVersion,
    type SalesActor, type SalesQuery } from '../services/sales-report.service';
import { isReceivingTransactionConflict } from '../services/receiving-guard.service';

const actorOf = (res: Response) => res.locals.authUser as SalesActor;
function errorResponse(res: Response, error: unknown) {
    if (error instanceof SalesReportError) {
        res.status(error.status).json({ error: error.message, code: error.code });
    } else if (isReceivingTransactionConflict(error) || ['P2002', 'P2003', 'P2025', 'P2004'].includes(prismaErrorCode(error) ?? '')) {
        res.status(409).json({ error: 'Report already exists or data changed. Reload before retrying.', code: 'SALES_REPORT_CONFLICT' });
    } else {
        res.status(503).json({ error: 'Sales reporting database temporarily unavailable', code: 'SALES_REPORT_UNAVAILABLE' });
    }
}
function actionBody(raw: unknown, action: 'submit' | 'return' | 'approve') {
    const body = readBody(raw);
    const allowed = action === 'submit' ? ['expectedVersion'] : action === 'return'
        ? ['expectedVersion', 'revisionNumber', 'reason'] : ['expectedVersion', 'revisionNumber'];
    if (!body || !onlyKeys(body, allowed)) throw new SalesReportError('Invalid action body');
    const expectedVersion = salesVersion(body.expectedVersion);
    const revisionNumber = action === 'submit' ? null : salesVersion(body.revisionNumber);
    let reason: string | null = null;
    if (action === 'return') {
        if (typeof body.reason !== 'string' || body.reason.includes('\0') || !body.reason.trim() || body.reason.trim().length > 1000) {
            throw new SalesReportError('Return reason is required (maximum 1000 characters)');
        }
        reason = body.reason.trim();
    }
    return { expectedVersion, revisionNumber, reason };
}

export function createSalesReportRouter(prisma: PrismaClient) {
    const router = Router();
    const service = createSalesReportService(prisma);
    router.use((_req, res, next) => {
        const actor = actorOf(res);
        if (!actor) { res.status(401).json({ error: 'Unauthorized' }); return; }
        if (!['ADMIN', 'BRANCH_MANAGER', 'STAFF'].includes(actor.role)) {
            res.status(403).json({ error: 'Forbidden' }); return;
        }
        next();
    });
    router.get('/', async (req, res) => {
        try {
            if (!onlyKeys(req.query, ['branchId', 'from', 'to', 'shift', 'status', 'page'])) throw new SalesReportError('Invalid query');
            const page = readPage(req.query.page);
            if (!page) throw new SalesReportError('Invalid page');
            const query: SalesQuery = { page };
            if (req.query.branchId !== undefined) query.branchId = salesId(req.query.branchId);
            if (req.query.from !== undefined) query.from = salesDate(req.query.from);
            if (req.query.to !== undefined) query.to = salesDate(req.query.to);
            if (query.from && query.to && query.from > query.to) throw new SalesReportError('Invalid date range');
            if (req.query.shift !== undefined) {
                if (!['MORNING', 'AFTERNOON', 'EVENING'].includes(String(req.query.shift)) || typeof req.query.shift !== 'string') throw new SalesReportError('Invalid shift');
                query.shift = req.query.shift as NonNullable<SalesQuery['shift']>;
            }
            if (req.query.status !== undefined) {
                if (!['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(String(req.query.status)) || typeof req.query.status !== 'string') throw new SalesReportError('Invalid status');
                query.status = req.query.status as NonNullable<SalesQuery['status']>;
            }
            res.json(await service.list(actorOf(res), query));
        } catch (error) { errorResponse(res, error); }
    });
    // Work context: manager branches by area, staff only their scheduled shifts on the selected date.
    // Requires session authentication and always re-reads user scope from PostgreSQL.
    router.get('/work-context', async (req, res) => {
        try {
            const day = salesDate(req.query.businessDate);
            const actor = actorOf(res);
            const user = await prisma.user.findUnique({ where: { id: actor.id }, select: {
                id: true, role: true, workKind: true, areaId: true, isActive: true,
                area: { select: { isActive: true } },
            } });
            if (!user?.isActive) return void res.status(403).json({ error: 'Account inactive' });
            if (user.role === 'STAFF') {
                if (user.workKind !== 'SALES' || !user.areaId || !user.area?.isActive)
                    return void res.status(403).json({ error: 'No active sales area' });
                const shifts = await prisma.shiftAssignment.findMany({ where: {
                    userId: user.id, businessDate: day, status: 'SCHEDULED',
                    branch: { areaId: user.areaId, isActive: true },
                }, select: { branchId: true, shift: true, branch: { select: { id: true, code: true, name: true, isActive: true } } },
                orderBy: { shift: 'asc' } });
                const branches = [...new Map(shifts.map(item => [item.branch.id, item.branch])).values()];
                return void res.json({ branches, assignments: shifts.map(item => ({ branchId: item.branchId, shift: item.shift })) });
            }
            if (user.role === 'BRANCH_MANAGER' && (!user.areaId || !user.area?.isActive))
                return void res.status(403).json({ error: 'No active manager area' });
            const branches = await prisma.branch.findMany({
                where: user.role === 'ADMIN' ? {} : { areaId: user.areaId! },
                select: { id: true, code: true, name: true, isActive: true },
                orderBy: { code: 'asc' }, take: 300,
            });
            res.json({ branches, assignments: [] });
        } catch (error) { errorResponse(res, error); }
    });
    router.post('/', async (req, res) => {
        try { res.status(201).json({ data: await service.create(actorOf(res), parseSalesInput(req.body, false).input) }); }
        catch (error) { errorResponse(res, error); }
    });
    router.get('/:id', async (req, res) => {
        try { res.json({ data: await service.get(actorOf(res), salesId(req.params.id)) }); }
        catch (error) { errorResponse(res, error); }
    });
    router.patch('/:id', async (req, res) => {
        try {
            const { input, expectedVersion } = parseSalesInput(req.body, true);
            res.json({ data: await service.update(actorOf(res), salesId(req.params.id), input, expectedVersion!) });
        } catch (error) { errorResponse(res, error); }
    });
    router.post('/:id/submit', async (req, res) => {
        try {
            const body = actionBody(req.body, 'submit');
            res.json({ data: await service.submit(actorOf(res), salesId(req.params.id), body.expectedVersion) });
        } catch (error) { errorResponse(res, error); }
    });
    for (const decision of ['return', 'approve'] as const) {
        router.post(`/:id/${decision}`, async (req, res) => {
            try {
                const body = actionBody(req.body, decision);
                res.json({ data: await service.review(actorOf(res), salesId(req.params.id), body.expectedVersion,
                    body.revisionNumber!, decision === 'return' ? 'RETURNED' : 'APPROVED', body.reason) });
            } catch (error) { errorResponse(res, error); }
        });
    }
    router.get('/:id/revisions', async (req, res) => {
        try { res.json({ data: await service.revisions(actorOf(res), salesId(req.params.id)) }); }
        catch (error) { errorResponse(res, error); }
    });
    return router;
}
