import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { DistributionActor } from '../services/distribution.service';
import { listDeliveryDiscrepancies, getDeliveryDiscrepancy, resolveDeliveryDiscrepancy,
    discrepancyFailure } from '../services/delivery-discrepancy.service';

export function createDeliveryDiscrepancyRouter(db: PrismaClient) {
    const router = Router();
    const actor = (res: Response) => res.locals.authUser as DistributionActor;
    const failure = (res: Response,error:unknown) => {
        const out = discrepancyFailure(error); res.status(out.status).json({ error: out.message });
    };
    router.get('/cases',async (req,res) => {
        try {
            if (Object.keys(req.query).some(k=>!['businessDate','status'].includes(k)) ||
                typeof req.query.businessDate !== 'string' ||
                (req.query.status !== undefined && typeof req.query.status !== 'string'))
                return void res.status(400).json({ error: 'Tham số không hợp lệ.' });
            res.setHeader('Cache-Control','no-store');
            res.json({ items: await listDeliveryDiscrepancies(db,actor(res),req.query.businessDate,req.query.status as string|undefined) });
        } catch (error) { failure(res,error); }
    });
    router.get('/cases/:id', async (req,res) => {
        try { res.setHeader('Cache-Control','no-store'); res.json({ data: await getDeliveryDiscrepancy(db,actor(res),req.params.id) }); }
        catch(error) { failure(res,error); }
    });
    router.post('/cases/:id/resolve', async (req,res) => {
        try { res.json({ data: await resolveDeliveryDiscrepancy(db,actor(res),req.params.id,req.body) }); }
        catch(error) { failure(res,error); }
    });
    return router;
}
