/** G7: reconciles physical G4 delivery shortages against G6 cases.
 * Only verifiably recovered, previously MISSING goods may be credited at a branch.
 * G4 already credited good received quantity; damaged/unrecovered goods are never credited twice.
 */
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, readBody, UUID_RE, prismaErrorCode } from '../utils/admin-api';
import type { DistributionActor } from './distribution.service';
import { lockReceivingBranches, isReceivingTransactionConflict } from './receiving-guard.service';

export class RecoveryError extends Error {
    constructor(message: string, public readonly status = 409) { super(message); }
}
type Database = PrismaClient | Prisma.TransactionClient;
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 };
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const ZERO = new Prisma.Decimal(0);
function uuid(value: unknown) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new RecoveryError('ID không hợp lệ.', 400);
    return value.toLowerCase();
}
function day(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RecoveryError('Ngày không hợp lệ.', 400);
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        throw new RecoveryError('Ngày không hợp lệ.', 400);
    return parsed;
}
function explanation(value: unknown) {
    if (typeof value !== 'string' || value.trim().length < 10 || value.trim().length > 500)
        throw new RecoveryError('Yêu cầu giải trình từ 10 đến 500 ký tự.', 400);
    return value.trim();
}
function decimal(value: unknown) {
    if (typeof value !== 'string' || !amountPattern.test(value))
        throw new RecoveryError('Số lượng phải là chuỗi số dương, tối đa 6 số lẻ.', 400);
    const parsed = new Prisma.Decimal(value);
    if (parsed.lte(0)) throw new RecoveryError('Số lượng thu hồi phải lớn hơn 0.', 400);
    return parsed;
}
async function scope(db: Database, actor: DistributionActor) {
    const user = await db.user.findUnique({ where: { id: actor.id }, select: {
        role: true, isActive: true, areaId: true, area: { select: { isActive: true } },
    } });
    if (!user?.isActive || (user.role !== 'ADMIN' && user.role !== 'BRANCH_MANAGER') ||
        (user.role === 'BRANCH_MANAGER' && (!user.areaId || !user.area?.isActive)))
        throw new RecoveryError('Không có quyền đối soát chênh lệch.', 403);
    return user;
}
const requestSelect = {
    id: true, discrepancyId: true, branchId: true, submissionKey: true, status: true, evidence: true,
    createdById: true, reviewedById: true, reviewNote: true, reviewedAt: true, createdAt: true,
    branch: { select: { code: true, name: true, areaId: true } },
    createdBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
    discrepancy: { select: { status: true, classification: true,
        stop: { select: { trip: { select: { code: true, businessDate: true } }, receivedById: true } },
    } },
    lines: { orderBy: { ingredientId: 'asc' }, select: {
        ingredientId: true, quantity: true, ingredient: { select: { code: true, name: true, unit: true } },
    } },
    events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        action: true, note: true, createdAt: true, actor: { select: { displayName: true } },
    } },
} as const;
async function getRequest(db: Database, actor: DistributionActor, requestId: string) {
    const user = await scope(db, actor);
    const result = await db.deliveryRecoveryAdjustment.findUnique({ where: { id: uuid(requestId) }, select: requestSelect });
    if (!result) throw new RecoveryError('Không tìm thấy chứng từ thu hồi.', 404);
    if (user.role === 'BRANCH_MANAGER' && result.branch.areaId !== user.areaId)
        throw new RecoveryError('Chứng từ nằm ngoài khu vực phụ trách.', 403);
    return result;
}
export async function listRecoveryRequests(db: PrismaClient, actor: DistributionActor, businessDate: string) {
    const user = await scope(db, actor);
    return db.deliveryRecoveryAdjustment.findMany({ where: {
        discrepancy: { stop: { trip: { businessDate: day(businessDate) } } },
        ...(user.role === 'BRANCH_MANAGER' ? { branch: { areaId: user.areaId! } } : {}),
    }, select: requestSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 150 });
}
export async function reconciliationReport(db: PrismaClient, actor: DistributionActor, businessDate: string) {
    const user = await scope(db, actor);
    const cases = await db.deliveryDiscrepancy.findMany({ where: {
        stop: { trip: { businessDate: day(businessDate) },
            ...(user.role === 'BRANCH_MANAGER' ? { branch: { areaId: user.areaId! } } : {}) },
    }, select: {
        id: true, status: true, classification: true, resolutionNote: true, createdAt: true,
        stop: { select: {
            branchId: true, branch: { select: { code: true, name: true, areaId: true } },
            trip: { select: { code: true, warehouse: { select: { code: true } } } },
            items: { orderBy: { ingredientId: 'asc' }, select: { ingredientId: true,
                plannedQuantity: true, receivedQuantity: true, damagedQuantity: true,
                ingredient: { select: { code: true, name: true, unit: true } },
            } },
        } },
        recoveryAdjustments: { where: { status: 'POSTED' }, select: { lines: { select: { ingredientId: true, quantity: true } } } },
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 150 });
    return cases.map(record => {
        const recovered = new Map<string, Prisma.Decimal>();
        for (const doc of record.recoveryAdjustments) for (const line of doc.lines)
            recovered.set(line.ingredientId, (recovered.get(line.ingredientId) ?? ZERO).plus(line.quantity));
        const rows = record.stop.items.map(item => {
            const received = item.receivedQuantity ?? ZERO;
            const damaged = item.damagedQuantity ?? ZERO;
            const missing = Prisma.Decimal.max(ZERO, item.plannedQuantity.minus(received).minus(damaged));
            const restored = recovered.get(item.ingredientId) ?? ZERO;
            return {
                ingredientId: item.ingredientId, ingredient: item.ingredient,
                plannedQuantity: item.plannedQuantity.toFixed(6), receivedQuantity: received.toFixed(6),
                damagedQuantity: damaged.toFixed(6), missingQuantity: missing.toFixed(6),
                recoveredQuantity: restored.toFixed(6), outstandingQuantity: Prisma.Decimal.max(ZERO, missing.minus(restored)).toFixed(6),
            };
        });
        return { id: record.id, status: record.status, classification: record.classification,
            resolutionNote: record.resolutionNote, createdAt: record.createdAt,
            branchId: record.stop.branchId, branch: record.stop.branch, trip: record.stop.trip, items: rows };
    });
}

export async function submitRecoveryRequest(db: PrismaClient, actor: DistributionActor, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['submissionKey', 'discrepancyId', 'evidence', 'lines']) ||
        !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50)
        throw new RecoveryError('Dữ liệu thu hồi không hợp lệ (1–50 SKU).', 400);
    const submissionKey = uuid(body.submissionKey);
    const discrepancyId = uuid(body.discrepancyId);
    const evidence = explanation(body.evidence);
    const lines = body.lines.map(raw => {
        const value = readBody(raw);
        if (!value || !onlyKeys(value, ['ingredientId', 'quantity'])) throw new RecoveryError('Dòng hàng không hợp lệ.', 400);
        return { ingredientId: uuid(value.ingredientId), quantity: decimal(value.quantity) };
    });
    if (new Set(lines.map(x => x.ingredientId)).size !== lines.length)
        throw new RecoveryError('Không được lặp SKU trong chứng từ.', 400);
    await scope(db, actor);
    const previous = await db.deliveryRecoveryAdjustment.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
    if (previous) {
        if (previous.createdById !== actor.id) throw new RecoveryError('Mã gửi đã được sử dụng.', 409);
        return getRequest(db, actor, previous.id);
    }
    try {
        return await db.$transaction(async tx => {
            const user = await scope(tx, actor);
            const found = await tx.deliveryDiscrepancy.findUnique({ where: { id: discrepancyId }, select: {
                status: true, stop: { select: { branchId: true, branch: { select: { areaId: true, isActive: true } },
                    items: { select: { ingredientId: true, plannedQuantity: true,
                        receivedQuantity: true, damagedQuantity: true,
                        ingredient: { select: { unit: true } } } } } },
            } });
            if (!found) throw new RecoveryError('Không tìm thấy hồ sơ chênh lệch.', 404);
            if (found.status !== 'RESOLVED') throw new RecoveryError('Cần kết luận hồ sơ G6 trước khi xin ghi nhận thu hồi.', 409);
            if (!found.stop.branch.isActive || (user.role === 'BRANCH_MANAGER' && found.stop.branch.areaId !== user.areaId))
                throw new RecoveryError('Không có quyền với quầy này.', 403);
            const posted = await tx.deliveryRecoveryAdjustment.findMany({ where: { discrepancyId, status: 'POSTED' },
                select: { lines: { select: { ingredientId: true, quantity: true } } } });
            const earlier = new Map<string, Prisma.Decimal>();
            for (const doc of posted) for (const line of doc.lines)
                earlier.set(line.ingredientId, (earlier.get(line.ingredientId) ?? ZERO).plus(line.quantity));
            for (const line of lines) {
                const item = found.stop.items.find(x => x.ingredientId === line.ingredientId);
                if (!item || item.receivedQuantity === null || item.damagedQuantity === null)
                    throw new RecoveryError('SKU chưa có dữ liệu kiểm đếm thực nhận hợp lệ.', 409);
                const stillMissing = item.plannedQuantity.minus(item.receivedQuantity).minus(item.damagedQuantity)
                    .minus(earlier.get(line.ingredientId) ?? ZERO);
                if (stillMissing.lte(0) || line.quantity.gt(stillMissing))
                    throw new RecoveryError('Số lượng thu hồi vượt phần thiếu chưa ghi nhận.', 409);
                if (item.ingredient.unit === 'piece' && !line.quantity.isInteger())
                    throw new RecoveryError('Hàng tính theo cái phải là số nguyên.', 400);
            }
            const created = await tx.deliveryRecoveryAdjustment.create({ data: {
                discrepancyId, branchId: found.stop.branchId, submissionKey, evidence, createdById: actor.id,
                lines: { create: lines.map(line => ({ ingredientId: line.ingredientId, quantity: line.quantity })) },
                events: { create: { actorId: actor.id, action: 'SUBMITTED', note: evidence } },
            }, select: { id: true } });
            return getRequest(tx, actor, created.id);
        }, txOptions);
    } catch (error) {
        if (prismaErrorCode(error) === 'P2002') {
            const duplicate = await db.deliveryRecoveryAdjustment.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
            if (duplicate?.createdById === actor.id) return getRequest(db, actor, duplicate.id);
        }
        throw error;
    }
}

export async function reviewRecoveryRequest(db: PrismaClient, actor: DistributionActor, requestId: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['decision', 'note']) || !['POSTED', 'REJECTED'].includes(String(body.decision)))
        throw new RecoveryError('Quyết định không hợp lệ.', 400);
    const decision = String(body.decision) as 'POSTED' | 'REJECTED';
    const note = explanation(body.note);
    return db.$transaction(async tx => {
        const user = await scope(tx, actor);
        if (user.role !== 'ADMIN') throw new RecoveryError('Chỉ ADMIN được phê duyệt và ghi tăng tồn.', 403);
        const request = await tx.deliveryRecoveryAdjustment.findUnique({ where: { id: uuid(requestId) },
            include: { lines: true, discrepancy: { include: {
                stop: { include: { items: { include: { ingredient: { select: { unit: true } } } } } },
            } } } });
        if (!request) throw new RecoveryError('Không tìm thấy chứng từ.', 404);
        if (request.status !== 'SUBMITTED') throw new RecoveryError('Chứng từ đã được xử lý.', 409);
        if (request.createdById === actor.id || request.discrepancy.stop.receivedById === actor.id)
            throw new RecoveryError('Không được tự duyệt chứng từ đã lập hoặc hàng do chính mình nhận.', 403);
        if (request.branchId !== request.discrepancy.stop.branchId || request.discrepancy.status !== 'RESOLVED')
            throw new RecoveryError('Hồ sơ G6 không còn hợp lệ để điều chỉnh.', 409);
        // Branch barrier must be acquired before updating stock: interoperates with G4/B6.
        await lockReceivingBranches(tx, [request.branchId]);
        if (decision === 'POSTED') {
            // Deterministic branch lock serializes all G7 approvals for the same branch.
            const otherPosted = await tx.deliveryRecoveryAdjustment.findMany({ where: {
                discrepancyId: request.discrepancyId, status: 'POSTED', id: { not: request.id },
            }, select: { lines: { select: { ingredientId: true, quantity: true } } } });
            const already = new Map<string, Prisma.Decimal>();
            for (const doc of otherPosted) for (const line of doc.lines)
                already.set(line.ingredientId, (already.get(line.ingredientId) ?? ZERO).plus(line.quantity));
            for (const line of request.lines) {
                const origin = request.discrepancy.stop.items.find(i => i.ingredientId === line.ingredientId);
                if (!origin || origin.receivedQuantity === null || origin.damagedQuantity === null)
                    throw new RecoveryError('Không tìm thấy dòng giao hàng ban đầu.', 409);
                const stillMissing = origin.plannedQuantity.minus(origin.receivedQuantity).minus(origin.damagedQuantity)
                    .minus(already.get(line.ingredientId) ?? ZERO);
                if (stillMissing.lte(0) || line.quantity.gt(stillMissing))
                    throw new RecoveryError('Số lượng thu hồi vượt phần thiếu còn lại. Từ chối hoặc yêu cầu sửa chứng từ.', 409);
                if (origin.ingredient.unit === 'piece' && !line.quantity.isInteger())
                    throw new RecoveryError('Mặt hàng tính theo cái phải là số nguyên.', 409);
            }
        }
        const change = await tx.deliveryRecoveryAdjustment.updateMany({ where: { id: request.id, status: 'SUBMITTED' },
            data: { status: decision, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note } });
        if (change.count !== 1) throw new RecoveryError('Chứng từ đã được xử lý. Hãy tải lại.', 409);
        if (decision === 'POSTED') {
            for (const line of [...request.lines].sort((a,b) => a.ingredientId.localeCompare(b.ingredientId))) {
                const balance = await tx.inventoryBalance.upsert({
                    where: { branchId_ingredientId: { branchId: request.branchId, ingredientId: line.ingredientId } },
                    create: { branchId: request.branchId, ingredientId: line.ingredientId, quantity: line.quantity },
                    update: { quantity: { increment: line.quantity } },
                });
                await tx.inventoryMovement.create({ data: {
                    branchId: request.branchId, ingredientId: line.ingredientId, actorId: actor.id,
                    kind: 'COUNT_ADJUSTMENT', sourceId: request.id, delta: line.quantity, quantityAfter: balance.quantity,
                } });
            }
            await tx.branch.update({ where: { id: request.branchId }, data: {
                receivingRevision: { increment: 1 }, inventoryRevision: { increment: 1 },
            } });
        }
        await tx.deliveryRecoveryAdjustmentEvent.create({ data: {
            adjustmentId: request.id, actorId: actor.id, action: decision, note,
        } });
        return getRequest(tx, actor, request.id);
    }, txOptions);
}
export function recoveryFailure(error: unknown) {
    if (error instanceof RecoveryError) return { status: error.status, message: error.message };
    if (isReceivingTransactionConflict(error) || ['P2002','P2003','P2025','P2034'].includes(prismaErrorCode(error) ?? ''))
        return { status: 409, message: 'Dữ liệu đã thay đổi. Hãy tải lại hồ sơ, không gửi lại yêu cầu chưa đối chiếu.' };
    return { status: 503, message: 'Không thực hiện được đối soát; kiểm tra trạng thái chứng từ trên máy chủ.' };
}
