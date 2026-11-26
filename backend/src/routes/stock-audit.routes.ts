import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { DistributionActor } from '../services/distribution.service';
import { StockAuditError, stockAuditSnapshot } from '../services/stock-audit.service';

/** G9 is intentionally read-only: no mutations or raw SQL supplied by the client. */
export function createStockAuditRouter(db: PrismaClient) {
    const router = Router();
    router.get('/snapshot', async (req, res: Response) => {
        try {
            if (Object.keys(req.query).some(key => key !== 'from' && key !== 'to'))
                return void res.status(400).json({ error: 'Bộ lọc không hợp lệ.' });
            res.setHeader('Cache-Control', 'no-store');
            res.json(await stockAuditSnapshot(db, res.locals.authUser as DistributionActor, req.query.from, req.query.to));
        } catch (error) {
            if (error instanceof StockAuditError) return void res.status(error.status).json({ error: error.message });
            res.status(503).json({ error: 'Không thể lập báo cáo G9. Kiểm tra kết nối và các migration còn chờ.' });
        }
    });
    return router;
}
