import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { listRestockPlans, getRestockPlan, submitRestockPlan, reviewRestockPlan,
    convertRestockPlan, approvalFailure } from '../services/restock-approval.service';
import type { DistributionActor } from '../services/distribution.service';

export function createRestockApprovalRouter(db: PrismaClient) {
    const router = Router();
    const actor = (res: Response) => res.locals.authUser as DistributionActor;
    const failure = (res: Response, error: unknown) => {
        const out = approvalFailure(error); res.status(out.status).json({ error: out.message });
    };
    router.get('/plans', async (req,res) => {
        try {
            if (Object.keys(req.query).some(k=>k !== 'businessDate') || typeof req.query.businessDate !== 'string')
                return void res.status(400).json({ error: 'Cần ngày kế hoạch.' });
            res.setHeader('Cache-Control','no-store');
            res.json({ items: await listRestockPlans(db,actor(res),req.query.businessDate) });
        } catch (error) { failure(res,error); }
    });
    router.get('/plans/:id', async (req,res) => {
        try { res.setHeader('Cache-Control','no-store'); res.json({ data: await getRestockPlan(db,actor(res),req.params.id) }); }
        catch (error) { failure(res,error); }
    });
    router.post('/plans', async (req,res) => {
        try { res.status(201).json({ data: await submitRestockPlan(db,actor(res),req.body) }); }
        catch (error) { failure(res,error); }
    });
    router.post('/plans/:id/review', async (req,res) => {
        try { res.json({ data: await reviewRestockPlan(db,actor(res),req.params.id,req.body) }); }
        catch (error) { failure(res,error); }
    });
    router.post('/plans/:id/convert', async (req,res) => {
        try { res.json({ data: await convertRestockPlan(db,actor(res),req.params.id,req.body) }); }
        catch (error) { failure(res,error); }
    });
    return router;
}
