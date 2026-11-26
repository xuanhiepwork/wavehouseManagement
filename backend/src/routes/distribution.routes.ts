import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import {
    type DistributionActor, distributionFailure, distributionBranches, listDistributionTrips,
    getDistributionTrip, dispatchDistributionTrip, receiveDistributionStop,
    localDate,
} from '../services/distribution.service';

export function createDistributionRouter(prisma: PrismaClient) {
    const router = Router();
    const actor = (res: Response): DistributionActor => res.locals.authUser as DistributionActor;
    const reply = (res: Response, error: unknown) => {
        const failure = distributionFailure(error);
        res.status(failure.status).json({ error: failure.message });
    };
    router.get('/branches', async (req, res) => {
        try { res.json({ items: await distributionBranches(prisma, actor(res), req.query.date as string | undefined) }); }
        catch (error) { reply(res, error); }
    });
    router.get('/trips', async (req, res) => {
        try {
            const d = req.query.date === undefined ? localDate() : req.query.date;
            if (typeof d !== 'string' || Object.keys(req.query).some(k => k !== 'date'))
                return void res.status(400).json({ error: 'Tham số ngày không hợp lệ.' });
            res.json({ items: await listDistributionTrips(prisma, actor(res), d) });
        } catch (error) { reply(res, error); }
    });
    router.get('/trips/:id', async (req, res) => {
        try { res.json({ data: await getDistributionTrip(prisma, actor(res), req.params.id) }); }
        catch (error) { reply(res, error); }
    });
    // G10: G6 plan approval is mandatory; the internal trip factory is only called
    // by convertRestockPlan in the same SERIALIZABLE transaction as plan conversion.
    // Never allow an arbitrary client to bypass the approval history.
    router.post('/trips', (_req, res) => {
        res.status(409).json({ error: 'Tạo chuyến trực tiếp đã được thay bằng G6. Hãy gửi đề xuất, chờ ADMIN khác người lập duyệt, rồi chuyển thành chuyến nháp.' });
    });
    router.post('/trips/:id/dispatch', async (req, res) => {
        try {
            if (req.body && Object.keys(req.body).length) return void res.status(400).json({ error: 'Thao tác xuất chuyến không có body.' });
            res.json({ data: await dispatchDistributionTrip(prisma, actor(res), req.params.id) });
        } catch (error) { reply(res, error); }
    });
    router.post('/stops/:id/receive', async (req, res) => {
        try { res.json({ data: await receiveDistributionStop(prisma, actor(res), req.params.id, req.body) }); }
        catch (error) { reply(res, error); }
    });
    return router;
}
