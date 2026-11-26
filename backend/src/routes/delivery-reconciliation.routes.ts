import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { DistributionActor } from '../services/distribution.service';
import { reconciliationReport, listRecoveryRequests, submitRecoveryRequest,
    reviewRecoveryRequest, recoveryFailure } from '../services/delivery-reconciliation.service';

export function createDeliveryReconciliationRouter(db: PrismaClient) {
    const router = Router();
    const actor = (res: Response) => res.locals.authUser as DistributionActor;
    const failure = (res: Response, error: unknown) => {
        const info = recoveryFailure(error); res.status(info.status).json({ error: info.message });
    };
    router.get('/report', async (req, res) => {
        try {
            if (Object.keys(req.query).some(key => key !== 'businessDate') ||
                typeof req.query.businessDate !== 'string')
                return void res.status(400).json({ error: 'Cần ngày giao hợp lệ.' });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ items: await reconciliationReport(db, actor(res), req.query.businessDate) });
        } catch (error) { failure(res, error); }
    });
    router.get('/requests', async (req, res) => {
        try {
            if (Object.keys(req.query).some(key => key !== 'businessDate') ||
                typeof req.query.businessDate !== 'string')
                return void res.status(400).json({ error: 'Cần ngày giao hợp lệ.' });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ items: await listRecoveryRequests(db, actor(res), req.query.businessDate) });
        } catch (error) { failure(res, error); }
    });
    router.post('/requests', async (req, res) => {
        try { res.status(201).json({ data: await submitRecoveryRequest(db, actor(res), req.body) }); }
        catch (error) { failure(res, error); }
    });
    router.post('/requests/:id/review', async (req, res) => {
        try { res.json({ data: await reviewRecoveryRequest(db, actor(res), req.params.id, req.body) }); }
        catch (error) { failure(res, error); }
    });
    return router;
}
