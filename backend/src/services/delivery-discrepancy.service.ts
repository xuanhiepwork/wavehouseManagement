/** G6: audit physical receiving shortages/damage without silently editing stock. */
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { UUID_RE, onlyKeys, readBody, prismaErrorCode } from '../utils/admin-api';
import type { DistributionActor } from './distribution.service';

export class DiscrepancyError extends Error {
    constructor(message: string, public status = 409) { super(message); }
}
const txOpts = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 };
const allowed = ['SHORTAGE','DAMAGED','COUNT_ERROR','OTHER'] as const;
function uuid(input: unknown) {
    if (typeof input !== 'string' || !UUID_RE.test(input)) throw new DiscrepancyError('ID không hợp lệ.', 400);
    return input.toLowerCase();
}
function atDate(input: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new DiscrepancyError('Ngày không hợp lệ.', 400);
    const result = new Date(input + 'T00:00:00.000Z');
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0,10) !== input)
        throw new DiscrepancyError('Ngày không hợp lệ.', 400);
    return result;
}
async function scope(db: PrismaClient | Prisma.TransactionClient, actor: DistributionActor) {
    const current = await db.user.findUnique({ where: { id: actor.id }, select: {
        isActive: true, role: true, areaId: true, area: { select: { isActive: true } },
    } });
    if (!current?.isActive || !['ADMIN','BRANCH_MANAGER'].includes(current.role) ||
        (current.role === 'BRANCH_MANAGER' && (!current.areaId || !current.area?.isActive)))
        throw new DiscrepancyError('Không được xử lý chênh lệch.', 403);
    return current;
}
const caseSelect = {
    id: true, stopId: true, status: true, classification: true, resolutionNote: true,
    resolvedAt: true, createdAt: true, resolvedBy: { select: { displayName: true } },
    stop: { select: {
        branchId: true, note: true, receivedById: true, receivedAt: true,
        branch: { select: { code: true, name: true, areaId: true } },
        trip: { select: { id: true, code: true, businessDate: true,
            warehouse: { select: { code: true, name: true } } } },
        items: { orderBy: { ingredientId: 'asc' }, select: {
            ingredientId: true, plannedQuantity: true, receivedQuantity: true, damagedQuantity: true,
            ingredient: { select: { code: true, name: true, unit: true } },
        } },
    } },
    events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, action: true, note: true, createdAt: true,
        actor: { select: { displayName: true } },
    } },
} satisfies Prisma.DeliveryDiscrepancySelect;
export async function listDeliveryDiscrepancies(db: PrismaClient, actor: DistributionActor,
    businessDate: string, status?: string) {
    const current = await scope(db, actor);
    if (status && !['OPEN','RESOLVED'].includes(status)) throw new DiscrepancyError('Trạng thái không hợp lệ.', 400);
    return db.deliveryDiscrepancy.findMany({ where: {
        stop: { trip: { businessDate: atDate(businessDate) },
            ...(current.role === 'BRANCH_MANAGER' ? { branch: { areaId: current.areaId! } } : {}) },
        ...(status ? { status } : {}),
    }, select: caseSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 150 });
}
export async function getDeliveryDiscrepancy(db: PrismaClient, actor: DistributionActor, caseId: string) {
    const current = await scope(db, actor);
    const found = await db.deliveryDiscrepancy.findUnique({ where: { id: uuid(caseId) }, select: caseSelect });
    if (!found) throw new DiscrepancyError('Không tìm thấy hồ sơ.', 404);
    if (current.role === 'BRANCH_MANAGER' && found.stop.branch.areaId !== current.areaId)
        throw new DiscrepancyError('Hồ sơ không thuộc khu vực quản lý.', 403);
    return found;
}
export async function resolveDeliveryDiscrepancy(db: PrismaClient, actor: DistributionActor,
    caseId: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body,['classification','note']) ||
        !allowed.includes(body.classification as typeof allowed[number]) ||
        typeof body.note !== 'string' || body.note.trim().length < 10 || body.note.trim().length > 500)
        throw new DiscrepancyError('Cần phân loại và giải trình ít nhất 10 ký tự.', 400);
    const resolutionNote = body.note;
    return db.$transaction(async tx => {
        const current = await scope(tx, actor);
        const found = await tx.deliveryDiscrepancy.findUnique({ where: { id: uuid(caseId) },
            select: { status: true, stop: { select: { receivedById: true, branch: { select: { areaId: true } } } } } });
        if (!found) throw new DiscrepancyError('Không tìm thấy hồ sơ.', 404);
        if (current.role === 'BRANCH_MANAGER' && found.stop.branch.areaId !== current.areaId)
            throw new DiscrepancyError('Hồ sơ không thuộc khu vực quản lý.', 403);
        if (found.stop.receivedById === actor.id)
            throw new DiscrepancyError('Người xác nhận nhận hàng không được tự kết luận chênh lệch.', 403);
        const changed = await tx.deliveryDiscrepancy.updateMany({ where: { id: caseId, status: 'OPEN' }, data: {
            status: 'RESOLVED', classification: body.classification as typeof allowed[number],
            resolutionNote: resolutionNote.trim(), resolvedById: actor.id, resolvedAt: new Date(),
        } });
        if (changed.count !== 1) throw new DiscrepancyError('Hồ sơ đã được xử lý, hãy tải lại.', 409);
        await tx.deliveryDiscrepancyEvent.create({ data: {
            discrepancyId: caseId, actorId: actor.id, action: 'RESOLVED', note: resolutionNote.trim(),
        } });
        return tx.deliveryDiscrepancy.findUniqueOrThrow({ where: { id: caseId }, select: caseSelect });
    }, txOpts);
}
export function discrepancyFailure(error: unknown) {
    if (error instanceof DiscrepancyError) return { status: error.status, message: error.message };
    if (['P2002','P2003','P2025','P2034'].includes(prismaErrorCode(error) ?? ''))
        return { status: 409, message: 'Dữ liệu đã thay đổi; hãy tải lại hồ sơ.' };
    return { status: 503, message: 'Không xử lý được hồ sơ chênh lệch. Kiểm tra lại trạng thái trên máy chủ.' };
}
