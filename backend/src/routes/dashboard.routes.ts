import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { SalesActor } from '../services/sales-report.service';
import { createDashboardService, DashboardError, parseDashboardQuery } from '../services/dashboard.service';
import { prismaErrorCode } from '../utils/admin-api';

export function createDashboardRouter(prisma: PrismaClient) {
    const router = Router();
    const service = createDashboardService(prisma);
    router.use((_req, res, next) => {
        const actor = res.locals.authUser as SalesActor | undefined;
        if (!actor) { res.status(401).json({ error: 'Unauthorized' }); return; }
        if (!['ADMIN', 'BRANCH_MANAGER'].includes(actor.role) || (actor.role !== 'ADMIN' && !actor.branchId)) {
            res.status(403).json({ error: 'Management access required', code: 'FORBIDDEN' }); return;
        }
        next();
    });
    router.get('/summary', async (req, res) => {
        try { res.json({ data: await service.summary(res.locals.authUser as SalesActor, parseDashboardQuery(req.query)) }); }
        catch (error) {
            if (error instanceof DashboardError) res.status(error.status).json({ error: error.message, code: error.code });
            else if (['P2021', 'P2022'].includes(prismaErrorCode(error) ?? '')) res.status(503).json({ error: 'Dashboard data is not ready', code: 'DASHBOARD_SCHEMA_NOT_READY' });
            else res.status(503).json({ error: 'Dashboard temporarily unavailable', code: 'DASHBOARD_UNAVAILABLE' });
        }
    });
    return router;
}
