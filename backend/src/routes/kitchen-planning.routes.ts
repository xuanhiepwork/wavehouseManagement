/** G5: read-only kitchen-to-branch planning on top of existing B7/AI3.
 * No new forecast model, stock mutation, automatic approval or dispatch.
 * ADMIN may turn a reviewed result into a G4 DRAFT via the existing distribution API.
 */
import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { UUID_RE, onlyKeys } from '../utils/admin-api';
import { buildRestockRecommendations, ForecastError } from '../services/restock-forecast.service';
import { buildAiDemandOverlay } from '../services/ai/overlay';
import { buildAuthorizedForecastRequest } from '../services/ai/export.service';
import type { AiOverlay, B7DemandRow } from '../services/ai/types';

type Actor = { id: string; role: string };
class ScopeError extends Error {
    constructor(message: string, public status = 403) { super(message); }
}
const day = (value: unknown): Date => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ScopeError('Ngày không hợp lệ.', 400);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ScopeError('Ngày không hợp lệ.', 400);
    return date;
};
const ids = (value: unknown): string[] => {
    if (typeof value !== 'string') throw new ScopeError('Danh sách quầy không hợp lệ.', 400);
    const rows = value.split(',').map(x => x.trim().toLowerCase());
    if (rows.length < 1 || rows.length > 10 || rows.some(x => !UUID_RE.test(x)) || new Set(rows).size !== rows.length)
        throw new ScopeError('Chọn từ 1 đến 10 quầy, không trùng lặp.', 400);
    return rows;
};
async function scope(db: PrismaClient, actor: Actor) {
    const current = await db.user.findUnique({ where: { id: actor.id },
        select: { role: true, isActive: true, areaId: true, area: { select: { isActive: true } } } });
    if (!current?.isActive || !['ADMIN', 'BRANCH_MANAGER'].includes(current.role) ||
        (current.role === 'BRANCH_MANAGER' && (!current.areaId || !current.area?.isActive))) {
        throw new ScopeError('Chỉ ADMIN và quản lý khu vực còn hiệu lực được xem kế hoạch.');
    }
    return current;
}
function failure(res: Response, error: unknown) {
    if (error instanceof ScopeError || error instanceof ForecastError) {
        res.status(error.status).json({ error: error.message }); return;
    }
    res.status(503).json({ error: 'Không thể tải kế hoạch kho bếp. Đối chiếu G3/G4 và quyền Aiven.' });
}
export function createKitchenPlanningRouter(db: PrismaClient) {
    const router = Router();
    router.get('/reference', async (_req, res) => {
        try {
            const current = await scope(db, res.locals.authUser as Actor);
            const [warehouses, branches] = await Promise.all([
                db.warehouse.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 100 }),
                db.branch.findMany({ where: { isActive: true,
                    ...(current.role === 'BRANCH_MANAGER' ? { areaId: current.areaId! } : {}) },
                    select: { id: true, code: true, name: true, areaId: true }, orderBy: { code: 'asc' }, take: 500 }),
            ]);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ warehouses, branches, canCreateG4Draft: current.role === 'ADMIN' });
        } catch (error) { failure(res, error); }
    });
    router.get('/recommendations', async (req, res) => {
        try {
            if (!onlyKeys(req.query, ['warehouseId', 'destinationBranchIds', 'businessDate', 'withAi']))
                throw new ScopeError('Tham số không hợp lệ.', 400);
            const current = await scope(db, res.locals.authUser as Actor);
            const warehouseId = req.query.warehouseId;
            if (typeof warehouseId !== 'string' || !UUID_RE.test(warehouseId)) throw new ScopeError('Mã kho không hợp lệ.', 400);
            const businessDate = day(req.query.businessDate);
            const destinationBranchIds = ids(req.query.destinationBranchIds);
            const withAi = req.query.withAi === 'true';
            if (req.query.withAi !== undefined && !['true', 'false'].includes(String(req.query.withAi)))
                throw new ScopeError('Tham số AI không hợp lệ.', 400);
            const count = await db.branch.count({ where: { id: { in: destinationBranchIds }, isActive: true,
                ...(current.role === 'BRANCH_MANAGER' ? { areaId: current.areaId! } : {}) } });
            if (count !== destinationBranchIds.length) throw new ScopeError('Có quầy ngoài khu vực quản lý hoặc đã ngừng hoạt động.');
            const data = await buildRestockRecommendations(db, {
                sourceWarehouseId: warehouseId.toLowerCase(), destinationBranchIds, businessDate, shift: 'MORNING',
            });
            let ai: AiOverlay | null = null;
            if (withAi) {
                const baselineRows: B7DemandRow[] = data.recommendations.map(row => ({
                    destinationBranchId: row.destinationBranchId, ingredientId: row.ingredientId,
                    unit: row.unit, predictedConsumption: row.predictedConsumption,
                }));
                try {
                    ai = await buildAiDemandOverlay({
                        businessDate: businessDate.toISOString().slice(0, 10), shift: 'MORNING', baselineRows,
                        buildAuthorizedRequest: (branchId, rows) => buildAuthorizedForecastRequest(
                            db, branchId, businessDate.toISOString().slice(0, 10), 'MORNING', rows),
                    });
                } catch {
                    // A broken/unavailable AI service must not discard B7. Never generate fake AI values.
                    ai = { status: 'B7_FALLBACK', deliveryQuantitiesRemainB7: true,
                        demandEstimates: baselineRows.map(row => ({ ...row, effectiveDemand: row.predictedConsumption,
                            source: 'B7_HEURISTIC', modelVersion: null, uncertaintyLower: null, uncertaintyUpper: null,
                            reason: 'AI_OVERLAY_UNAVAILABLE' })), warnings: ['AI không khả dụng; giữ nguyên đề xuất B7.'] };
                }
            }
            res.setHeader('Cache-Control', 'no-store');
            res.json({ data, ai, draftCreationRequiresAdminConfirmation: true,
                note: 'G5 chỉ xem trước. Tạo chuyến G4 DRAFT cần ADMIN xác nhận; chưa xuất hoặc giữ hàng.' });
        } catch (error) { failure(res, error); }
    });
    router.get('/operations', async (req, res) => {
        try {
            if (!onlyKeys(req.query, ['businessDate'])) throw new ScopeError('Tham số không hợp lệ.', 400);
            const businessDate = day(req.query.businessDate);
            const current = await scope(db, res.locals.authUser as Actor);
            const branches = await db.branch.findMany({ where: { isActive: true,
                ...(current.role === 'BRANCH_MANAGER' ? { areaId: current.areaId! } : {}) },
                select: { id: true, code: true, name: true, areaId: true }, take: 500 });
            const branchIds = branches.map(x => x.id);
            const [stops, reports, stockCounts] = await Promise.all([
                db.deliveryStop.findMany({ where: { branchId: { in: branchIds }, trip: { businessDate } },
                    select: { id: true, branchId: true, status: true, trip: { select: { status: true } },
                        items: { select: { plannedQuantity: true, receivedQuantity: true, damagedQuantity: true } } }, take: 5001 }),
                db.salesReport.count({ where: { branchId: { in: branchIds }, businessDate, status: 'SUBMITTED' } }),
                db.shiftStockCount.count({ where: { branchId: { in: branchIds }, businessDate, status: 'SUBMITTED' } }),
            ]);
            if (stops.length > 5000) throw new ScopeError('Nhiều điểm giao; hãy lọc phạm vi ngày.', 413);
            const pending = stops.filter(x => x.status === 'DISPATCHED').length;
            const received = stops.filter(x => x.status === 'RECEIVED').length;
            const discrepancies = stops.filter(x => x.status === 'RECEIVED' && x.items.some(i =>
                i.receivedQuantity === null || !i.receivedQuantity.plus(i.damagedQuantity ?? 0).eq(i.plannedQuantity))).length;
            res.setHeader('Cache-Control', 'no-store');
            res.json({ data: { businessDate: businessDate.toISOString().slice(0, 10), branchCount: branches.length,
                pendingReceivingStops: pending, receivedStops: received, discrepantStops: discrepancies,
                submittedSalesReports: reports, submittedStockCounts: stockCounts } });
        } catch (error) { failure(res, error); }
    });
    return router;
}
