import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { operationalBranchIds, isWorkShift, vietnamBusinessDay, type OperationalActor } from '../services/operational-access.service';

export function createOperationalBranchRouter(prisma: PrismaClient) {
    const router = Router();
    router.get('/', async (req, res) => {
        const actor = res.locals.authUser as OperationalActor;
        const dateArg = req.query.businessDate;
        const shift = req.query.shift;
        if (Object.keys(req.query).some(key => key !== 'businessDate' && key !== 'shift') ||
            (shift !== undefined && !isWorkShift(shift))) {
            res.status(400).json({ error: 'Invalid branch scope query' }); return;
        }
        const day = dateArg === undefined ? vietnamBusinessDay() :
            (typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)
                ? new Date(`${dateArg}T00:00:00.000Z`) : null);
        if (!day || Number.isNaN(day.getTime()) ||
            (dateArg !== undefined && day.toISOString().slice(0, 10) !== dateArg)) {
            res.status(400).json({ error: 'Invalid businessDate' }); return;
        }
        try {
            const ids = await operationalBranchIds(prisma, actor, day, isWorkShift(shift) ? shift : undefined);
            const rows = await prisma.branch.findMany({ where: { id: { in: ids }, isActive: true },
                select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: 'asc' } });
            res.json({ items: rows, businessDate: day.toISOString().slice(0, 10) });
        } catch {
            res.status(503).json({ error: 'Operational branch directory unavailable' });
        }
    });
    return router;
}
