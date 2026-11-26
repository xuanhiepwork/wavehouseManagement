/** G6: immutable B7 snapshot -> SUBMITTED -> APPROVED/REJECTED -> CONVERTED.
 * All review and conversion transitions are conditional and transactional.
 * A G4 DRAFT created from an approved plan does not dispatch/reserve stock.
 */
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, readBody, UUID_RE, prismaErrorCode } from '../utils/admin-api';
import { buildRestockRecommendations, ForecastError } from './restock-forecast.service';
import { createDistributionTrip, DistributionError, type DistributionActor } from './distribution.service';

export class ApprovalError extends Error {
    constructor(message: string, public status = 409) { super(message); }
}
type Actor = DistributionActor;
const txOpts = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 };
const qtyRe = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const tripCode = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
function uuid(input: unknown): string {
    if (typeof input !== 'string' || !UUID_RE.test(input)) throw new ApprovalError('ID không hợp lệ.', 400);
    return input.toLowerCase();
}
function text(input: unknown, max = 500, required = false): string | null {
    if (input == null || input === '') {
        if (required) throw new ApprovalError('Cần nhập lý do.', 400);
        return null;
    }
    if (typeof input !== 'string' || input.trim().length > max || (required && input.trim().length < 8))
        throw new ApprovalError('Nội dung không hợp lệ hoặc quá ngắn.', 400);
    return input.trim() || null;
}
function date(input: unknown): Date {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new ApprovalError('Ngày không hợp lệ.', 400);
    const result = new Date(input + 'T00:00:00.000Z');
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0,10) !== input) throw new ApprovalError('Ngày không hợp lệ.', 400);
    return result;
}
async function actorScope(db: PrismaClient | Prisma.TransactionClient, actor: Actor) {
    const current = await db.user.findUnique({ where: { id: actor.id }, select: {
        role: true, isActive: true, areaId: true, area: { select: { isActive: true } }, workKind: true,
    } });
    if (!current?.isActive || !['ADMIN', 'BRANCH_MANAGER'].includes(current.role) ||
        (current.role === 'BRANCH_MANAGER' && (!current.areaId || !current.area?.isActive)))
        throw new ApprovalError('Không có quyền sử dụng quy trình xét duyệt.', 403);
    return current;
}
const planSelect = {
    id: true, areaId: true, warehouseId: true, businessDate: true, status: true, submissionKey: true,
    createdById: true, reviewedById: true, reviewedAt: true, reviewNote: true,
    note: true, convertedAt: true, deliveryTripId: true, createdAt: true,
    area: { select: { name: true, code: true } }, warehouse: { select: { name: true, code: true } },
    createdBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
    lines: { orderBy: [{ branchId: 'asc' }, { ingredientId: 'asc' }], select: {
        branchId: true, ingredientId: true, quantity: true,
        branch: { select: { code: true, name: true } },
        ingredient: { select: { code: true, name: true, unit: true } },
    } },
    events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, action: true, note: true, createdAt: true, actor: { select: { displayName: true } },
    } },
} as const;

export async function listRestockPlans(db: PrismaClient, actor: Actor, businessDate: string) {
    const current = await actorScope(db, actor);
    return db.restockPlan.findMany({ where: {
        businessDate: date(businessDate),
        ...(current.role === 'BRANCH_MANAGER' ? { areaId: current.areaId! } : {}),
    }, select: planSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
}
export async function getRestockPlan(db: PrismaClient, actor: Actor, planId: string) {
    const current = await actorScope(db, actor);
    const plan = await db.restockPlan.findUnique({ where: { id: uuid(planId) }, select: planSelect });
    if (!plan) throw new ApprovalError('Không tìm thấy đề xuất.', 404);
    if (current.role !== 'ADMIN' && plan.areaId !== current.areaId) throw new ApprovalError('Ngoài khu vực quản lý.', 403);
    return plan;
}

type Item = { branchId: string; ingredientId: string; quantity: string };
function normalized(rows: Item[]): string[] {
    return rows.map(x => `${x.branchId}/${x.ingredientId}/${new Prisma.Decimal(x.quantity).toFixed(6)}`).sort();
}
export async function submitRestockPlan(db: PrismaClient, actor: Actor, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['submissionKey','warehouseId','businessDate','branchIds','expectedRows','note']))
        throw new ApprovalError('Dữ liệu đề xuất không hợp lệ.', 400);
    const submissionKey = uuid(body.submissionKey);
    const warehouseId = uuid(body.warehouseId);
    const businessDate = date(body.businessDate);
    const memo = text(body.note);
    const current = await actorScope(db, actor);
    // Stable client idempotency key; a network retry must not create another proposal.
    const previous = await db.restockPlan.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
    if (previous) {
        if (previous.createdById !== actor.id) throw new ApprovalError('Mã gửi đã được sử dụng.', 409);
        return getRestockPlan(db, actor, previous.id);
    }
    if (!Array.isArray(body.branchIds) || !body.branchIds.length || body.branchIds.length > 10)
        throw new ApprovalError('Chọn từ 1 đến 10 quầy.', 400);
    const branchIds = body.branchIds.map(uuid);
    if (new Set(branchIds).size !== branchIds.length) throw new ApprovalError('Danh sách quầy trùng.', 400);
    if (!Array.isArray(body.expectedRows) || body.expectedRows.length > 500)
        throw new ApprovalError('Danh sách SKU dự kiến không hợp lệ.', 400);
    const expected: Item[] = body.expectedRows.map(row => {
        const value = readBody(row);
        if (!value || !onlyKeys(value,['branchId','ingredientId','quantity']) ||
            typeof value.quantity !== 'string' || !qtyRe.test(value.quantity) || new Prisma.Decimal(value.quantity).lte(0))
            throw new ApprovalError('Số lượng dự kiến không hợp lệ.', 400);
        return { branchId: uuid(value.branchId), ingredientId: uuid(value.ingredientId), quantity: value.quantity };
    });
    if (new Set(expected.map(x => `${x.branchId}/${x.ingredientId}`)).size !== expected.length ||
        expected.some(x => !branchIds.includes(x.branchId))) throw new ApprovalError('SKU trùng hoặc quầy không khớp.', 400);
    const branches = await db.branch.findMany({ where: { id: { in: branchIds }, isActive: true },
        select: { id: true, areaId: true, area: { select: { isActive: true } } } });
    if (branches.length !== branchIds.length || branches.some(x => !x.areaId || !x.area?.isActive) ||
        new Set(branches.map(x => x.areaId)).size !== 1)
        throw new ApprovalError('Một đề xuất chỉ thuộc một khu vực còn hoạt động.', 409);
    const areaId = branches[0].areaId!;
    if (current.role === 'BRANCH_MANAGER' && areaId !== current.areaId)
        throw new ApprovalError('Quầy ngoài khu vực quản lý.', 403);
    // Server recomputes the B7 plan: clients cannot supply arbitrary quantities.
    const calculated = await buildRestockRecommendations(db, {
        sourceWarehouseId: warehouseId, destinationBranchIds: branchIds, businessDate, shift: 'MORNING',
    });
    const actual: Item[] = calculated.recommendations.filter(x => new Prisma.Decimal(x.proposedDeliveryQuantity).gt(0))
        .map(x => ({ branchId: x.destinationBranchId, ingredientId: x.ingredientId, quantity: x.proposedDeliveryQuantity }));
    if (!actual.length) throw new ApprovalError('Không có lượng hàng có thể cấp.', 409);
    if (actual.length > 500 || branchIds.some(id => actual.filter(x => x.branchId === id).length > 50))
        throw new ApprovalError('Vượt giới hạn 50 SKU/quầy.', 413);
    if (normalized(actual).join('|') !== normalized(expected).join('|'))
        throw new ApprovalError('Đề xuất đã thay đổi. Hãy tải lại số liệu B7 trước khi gửi.', 409);
    try {
        const record = await db.restockPlan.create({ data: {
            submissionKey, areaId, warehouseId, businessDate, note: memo, createdById: actor.id,
            lines: { create: actual.map(x => ({ branchId: x.branchId, ingredientId: x.ingredientId, quantity: x.quantity })) },
            events: { create: { actorId: actor.id, action: 'SUBMITTED', note: memo } },
        }, select: { id: true } });
        return getRestockPlan(db, actor, record.id);
    } catch (error) {
        if (prismaErrorCode(error) === 'P2002') {
            const record = await db.restockPlan.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
            if (record?.createdById === actor.id) return getRestockPlan(db, actor, record.id);
        }
        throw error;
    }
}
export async function reviewRestockPlan(db: PrismaClient, actor: Actor, planId: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body,['decision','note']) || !['APPROVED','REJECTED'].includes(String(body.decision)))
        throw new ApprovalError('Quyết định không hợp lệ.', 400);
    const decision = String(body.decision) as 'APPROVED' | 'REJECTED';
    const memo = text(body.note, 500, decision === 'REJECTED');
    return db.$transaction(async tx => {
        const current = await actorScope(tx, actor);
        if (current.role !== 'ADMIN') throw new ApprovalError('Chỉ ADMIN được duyệt đề xuất.', 403);
        const plan = await tx.restockPlan.findUnique({ where: { id: uuid(planId) }, select: { status: true, createdById: true } });
        if (!plan) throw new ApprovalError('Không tìm thấy đề xuất.', 404);
        if (plan.createdById === actor.id) throw new ApprovalError('Không được tự duyệt đề xuất của mình.', 403);
        const updated = await tx.restockPlan.updateMany({ where: { id: planId, status: 'SUBMITTED' }, data: {
            status: decision, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: memo,
        } });
        if (updated.count !== 1) throw new ApprovalError('Đề xuất đã được xử lý; hãy tải lại.', 409);
        await tx.restockPlanEvent.create({ data: { planId, actorId: actor.id, action: decision, note: memo } });
        return tx.restockPlan.findUniqueOrThrow({ where: { id: planId }, select: planSelect });
    }, txOpts);
}
export async function convertRestockPlan(db: PrismaClient, actor: Actor, planId: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body,['code','courierId']) || typeof body.code !== 'string')
        throw new ApprovalError('Thông tin chuyến giao không hợp lệ.', 400);
    const code = body.code.trim().toUpperCase();
    if (!tripCode.test(code)) throw new ApprovalError('Mã chuyến không hợp lệ.', 400);
    const courierId = uuid(body.courierId);
    return db.$transaction(async tx => {
        const current = await actorScope(tx, actor);
        if (current.role !== 'ADMIN') throw new ApprovalError('Chỉ ADMIN được chuyển đề xuất đã duyệt.', 403);
        const plan = await tx.restockPlan.findUnique({ where: { id: uuid(planId) },
            include: { lines: { select: { branchId: true, ingredientId: true, quantity: true } } } });
        if (!plan) throw new ApprovalError('Không tìm thấy đề xuất.', 404);
        if (plan.status !== 'APPROVED') throw new ApprovalError('Chỉ đề xuất đã duyệt, chưa chuyển mới tạo chuyến.', 409);
        if (!plan.lines.length) throw new ApprovalError('Đề xuất không có dòng hàng.', 409);
        const liveBranches = await tx.branch.findMany({ where: {
            id: { in: [...new Set(plan.lines.map(x => x.branchId))] }, isActive: true, areaId: plan.areaId,
        }, select: { id: true } });
        if (liveBranches.length !== new Set(plan.lines.map(x => x.branchId)).size)
            throw new ApprovalError('Quầy trong kế hoạch đã chuyển khu vực hoặc ngừng hoạt động.', 409);
        const grouped = new Map<string, { ingredientId: string; quantity: string }[]>();
        for (const row of plan.lines) grouped.set(row.branchId, [...(grouped.get(row.branchId) ?? []),
            { ingredientId: row.ingredientId, quantity: row.quantity.toFixed(6) }]);
        // Reuses existing G4 validation; trip creation AND plan claim commit atomically.
        const trip = await createDistributionTrip(tx, actor, {
            code, warehouseId: plan.warehouseId, businessDate: plan.businessDate.toISOString().slice(0,10),
            courierId, note: `G6 kế hoạch ${plan.id}; đã được ADMIN phê duyệt. Chưa xuất kho.`,
            stops: [...grouped].map(([branchId, items]) => ({ branchId, items })),
        });
        const claimed = await tx.restockPlan.updateMany({ where: { id: planId, status: 'APPROVED', deliveryTripId: null },
            data: { status: 'CONVERTED', convertedAt: new Date(), deliveryTripId: trip.id } });
        if (claimed.count !== 1) throw new ApprovalError('Đề xuất đã được chuyển bởi người khác.', 409);
        await tx.restockPlanEvent.create({ data: { planId, actorId: actor.id, action: 'CONVERTED', note: code } });
        return { planId, tripId: trip.id, tripCode: trip.code, status: 'CONVERTED' };
    }, txOpts);
}
export function approvalFailure(error: unknown) {
    if (error instanceof ApprovalError || error instanceof DistributionError || error instanceof ForecastError)
        return { status: error.status, message: error.message };
    if (['P2002','P2003','P2025','P2034'].includes(prismaErrorCode(error) ?? ''))
        return { status: 409, message: 'Dữ liệu đã thay đổi, tải lại trước khi thao tác.' };
    return { status: 503, message: 'Không thể xử lý đề xuất. Kiểm tra trạng thái đã lưu trước khi thử lại.' };
}
