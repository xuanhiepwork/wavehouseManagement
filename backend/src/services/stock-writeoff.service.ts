/** G8: submitted write-off requests are immutable; only a different ADMIN may post a decrement.
 * A write-off applies to exactly one physical location and never modifies a delivery case.
 */
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { UUID_RE, onlyKeys, readBody, prismaErrorCode } from '../utils/admin-api';
import { lockReceivingBranches, assertNoPendingReceipts, isReceivingTransactionConflict } from './receiving-guard.service';
import type { DistributionActor } from './distribution.service';

type Database = PrismaClient | Prisma.TransactionClient;
type LocationType = 'BRANCH' | 'WAREHOUSE';
type Reason = 'EXPIRED' | 'DAMAGED' | 'SPOILAGE' | 'LOSS' | 'COUNT_VARIANCE';
const reasons = ['EXPIRED', 'DAMAGED', 'SPOILAGE', 'LOSS', 'COUNT_VARIANCE'];
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 };
const ZERO = new Prisma.Decimal(0);
export class WriteOffError extends Error {
    constructor(message: string, public readonly status = 409) { super(message); }
}
function uuid(value: unknown): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new WriteOffError('ID không hợp lệ.', 400);
    return value.toLowerCase();
}
function note(value: unknown) {
    if (typeof value !== 'string' || value.trim().length < 10 || value.trim().length > 500)
        throw new WriteOffError('Cần giải trình từ 10 đến 500 ký tự.', 400);
    return value.trim();
}
function qty(value: unknown) {
    if (typeof value !== 'string' || !amountPattern.test(value))
        throw new WriteOffError('Số lượng phải là chuỗi thập phân dương, tối đa 6 chữ số lẻ.', 400);
    const result = new Prisma.Decimal(value);
    if (result.lte(ZERO)) throw new WriteOffError('Số lượng phải lớn hơn 0.', 400);
    return result;
}
async function identity(db: Database, actor: DistributionActor) {
    const user = await db.user.findUnique({ where: { id: actor.id }, select: {
        id: true, role: true, workKind: true, isActive: true, areaId: true, area: { select: { isActive: true } },
    } });
    if (!user?.isActive) throw new WriteOffError('Tài khoản không còn hoạt động.', 403);
    if (user.role === 'BRANCH_MANAGER' && (!user.areaId || !user.area?.isActive))
        throw new WriteOffError('Quản lý chưa có khu vực hoạt động.', 403);
    return user;
}
async function authorize(db: Database, actor: DistributionActor, locationType: LocationType, locationId: string) {
    const user = await identity(db, actor);
    if (locationType === 'BRANCH') {
        const branch = await db.branch.findUnique({ where: { id: locationId }, select: {
            id: true, code: true, name: true, isActive: true, areaId: true,
        } });
        if (!branch?.isActive) throw new WriteOffError('Quầy không còn hoạt động.', 404);
        if (user.role !== 'ADMIN' && (user.role !== 'BRANCH_MANAGER' || branch.areaId !== user.areaId))
            throw new WriteOffError('Không có quyền điều chỉnh tồn tại quầy.', 403);
        return user;
    }
    const warehouse = await db.warehouse.findUnique({ where: { id: locationId }, select: { isActive: true } });
    if (!warehouse?.isActive) throw new WriteOffError('Kho không còn hoạt động.', 404);
    if (user.role === 'ADMIN') return user;
    if (user.role !== 'STAFF' || user.workKind !== 'KITCHEN_DELIVERY')
        throw new WriteOffError('Không có quyền với kho bếp.', 403);
    const assigned = await db.warehouseWorkerAssignment.findUnique({
        where: { warehouseId_userId: { warehouseId: locationId, userId: actor.id } }, select: { isActive: true },
    });
    if (!assigned?.isActive)
        throw new WriteOffError('Không được phân công kho bếp này.', 403);
    return user;
}
function location(record: { branchId: string | null; warehouseId: string | null }) {
    return record.branchId ? { type: 'BRANCH' as const, id: record.branchId }
        : { type: 'WAREHOUSE' as const, id: record.warehouseId! };
}
const detailSelect = {
    id: true, submissionKey: true, branchId: true, warehouseId: true, reason: true, evidence: true,
    status: true, createdById: true, reviewedById: true, reviewNote: true, reviewedAt: true, createdAt: true,
    branch: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } },
    createdBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
    lines: { orderBy: { ingredientId: 'asc' }, select: {
        ingredientId: true, quantity: true, ingredient: { select: { code: true, name: true, unit: true } },
    } },
    events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        action: true, note: true, createdAt: true, actor: { select: { displayName: true } },
    } },
} as const;
async function detail(db: Database, actor: DistributionActor, id: string) {
    const result = await db.stockWriteOff.findUnique({ where: { id: uuid(id) }, select: detailSelect });
    if (!result) throw new WriteOffError('Không tìm thấy chứng từ.', 404);
    const place = location(result);
    await authorize(db, actor, place.type, place.id);
    return result;
}
export async function listWriteOffTargets(db: PrismaClient, actor: DistributionActor) {
    const user = await identity(db, actor);
    const [branches, warehouses] = await Promise.all([
        user.role === 'STAFF' ? Promise.resolve([]) : db.branch.findMany({ where: {
            isActive: true, ...(user.role === 'BRANCH_MANAGER' ? { areaId: user.areaId! } : {}),
        }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 250 }),
        user.role === 'BRANCH_MANAGER' || (user.role === 'STAFF' && user.workKind !== 'KITCHEN_DELIVERY')
            ? Promise.resolve([]) : db.warehouse.findMany({ where: {
                isActive: true,
                ...(user.role === 'STAFF' ? { workers: { some: { userId: user.id, isActive: true } } } : {}),
            }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 50 }),
    ]);
    return { branches, warehouses };
}
export async function listWriteOffBalances(db: PrismaClient, actor: DistributionActor,
    locationType: LocationType, locationId: string) {
    const id = uuid(locationId);
    await authorize(db, actor, locationType, id);
    const select = { ingredientId: true, quantity: true, ingredient: {
        select: { code: true, name: true, unit: true },
    } } as const;
    const list = locationType === 'BRANCH'
        ? await db.inventoryBalance.findMany({ where: { branchId: id, quantity: { gt: 0 } }, select,
            orderBy: { ingredientId: 'asc' }, take: 300 })
        : await db.warehouseInventoryBalance.findMany({ where: { warehouseId: id, quantity: { gt: 0 } }, select,
            orderBy: { ingredientId: 'asc' }, take: 300 });
    return list.map(row => ({ ...row, quantity: row.quantity.toFixed(6) }));
}
export async function listWriteOffs(db: PrismaClient, actor: DistributionActor) {
    const user = await identity(db, actor);
    if (user.role === 'STAFF' && user.workKind !== 'KITCHEN_DELIVERY')
        throw new WriteOffError('Không có quyền truy cập chứng từ G8.', 403);
    return db.stockWriteOff.findMany({ where: user.role === 'ADMIN' ? {} : user.role === 'BRANCH_MANAGER'
        ? { branch: { areaId: user.areaId! } }
        : { warehouse: { workers: { some: { userId: user.id, isActive: true } } } },
        select: detailSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 150 });
}
export async function submitWriteOff(db: PrismaClient, actor: DistributionActor, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['submissionKey', 'locationType', 'locationId', 'reason', 'evidence', 'lines']) ||
        !['BRANCH','WAREHOUSE'].includes(String(body.locationType)) ||
        !reasons.includes(String(body.reason)) || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50)
        throw new WriteOffError('Dữ liệu đề xuất giảm kho không hợp lệ (1–50 SKU).', 400);
    const submissionKey = uuid(body.submissionKey);
    const locationType = String(body.locationType) as LocationType;
    const locationId = uuid(body.locationId);
    const reason = String(body.reason) as Reason;
    const evidence = note(body.evidence);
    const lines = body.lines.map((row: unknown) => {
        const item = readBody(row);
        if (!item || !onlyKeys(item, ['ingredientId', 'quantity'])) throw new WriteOffError('Dòng hàng không hợp lệ.', 400);
        return { ingredientId: uuid(item.ingredientId), quantity: qty(item.quantity) };
    });
    if (new Set(lines.map(x => x.ingredientId)).size !== lines.length)
        throw new WriteOffError('Không được lặp nguyên liệu.', 400);
    await authorize(db, actor, locationType, locationId);
    const old = await db.stockWriteOff.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
    if (old) {
        if (old.createdById !== actor.id) throw new WriteOffError('Mã gửi đã được sử dụng.', 409);
        return detail(db, actor, old.id);
    }
    try {
        return await db.$transaction(async tx => {
            await authorize(tx, actor, locationType, locationId);
            const ids = lines.map(x => x.ingredientId);
            const ingredients = await tx.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true } });
            if (ingredients.length !== lines.length) throw new WriteOffError('Có SKU không tồn tại.', 409);
            const units = new Map(ingredients.map(x => [x.id, x.unit]));
            const balances = locationType === 'BRANCH'
                ? await tx.inventoryBalance.findMany({ where: { branchId: locationId, ingredientId: { in: ids } }, select: { ingredientId: true, quantity: true } })
                : await tx.warehouseInventoryBalance.findMany({ where: { warehouseId: locationId, ingredientId: { in: ids } }, select: { ingredientId: true, quantity: true } });
            const available = new Map(balances.map(x => [x.ingredientId, x.quantity]));
            for (const line of lines) {
                if (units.get(line.ingredientId) === 'piece' && !line.quantity.isInteger())
                    throw new WriteOffError('SKU tính theo cái phải là số nguyên.', 400);
                if (line.quantity.gt(available.get(line.ingredientId) ?? ZERO))
                    throw new WriteOffError('Lượng đề nghị vượt tồn hiện có. Hãy kiểm kê lại.', 409);
            }
            const created = await tx.stockWriteOff.create({ data: {
                submissionKey, branchId: locationType === 'BRANCH' ? locationId : null,
                warehouseId: locationType === 'WAREHOUSE' ? locationId : null,
                reason, evidence, createdById: actor.id,
                lines: { create: lines.map(x => ({ ingredientId: x.ingredientId, quantity: x.quantity })) },
                events: { create: { actorId: actor.id, action: 'SUBMITTED', note: evidence } },
            }, select: { id: true } });
            return detail(tx, actor, created.id);
        }, txOptions);
    } catch (error) {
        if (prismaErrorCode(error) === 'P2002') {
            const old = await db.stockWriteOff.findUnique({ where: { submissionKey }, select: { id: true, createdById: true } });
            if (old?.createdById === actor.id) return detail(db, actor, old.id);
        }
        throw error;
    }
}
export async function reviewWriteOff(db: PrismaClient, actor: DistributionActor, id: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['decision', 'note']) || !['POSTED','REJECTED'].includes(String(body.decision)))
        throw new WriteOffError('Quyết định không hợp lệ.', 400);
    const decision = String(body.decision) as 'POSTED'|'REJECTED';
    const reviewNote = note(body.note);
    return db.$transaction(async tx => {
        const reviewer = await identity(tx, actor);
        if (reviewer.role !== 'ADMIN') throw new WriteOffError('Chỉ ADMIN được phê duyệt G8.', 403);
        const request = await tx.stockWriteOff.findUnique({ where: { id: uuid(id) }, include: {
            lines: { include: { ingredient: { select: { unit: true } } } },
        } });
        if (!request) throw new WriteOffError('Chứng từ không tồn tại.', 404);
        if (request.status !== 'SUBMITTED') throw new WriteOffError('Chứng từ đã được xử lý.', 409);
        if (request.createdById === actor.id) throw new WriteOffError('Người lập không được tự duyệt.', 403);
        const place = location(request);
        await authorize(tx, actor, place.type, place.id);
        if (place.type === 'BRANCH') {
            await lockReceivingBranches(tx, [place.id]);
            if (decision === 'POSTED') await assertNoPendingReceipts(tx, place.id);
        }
        const claim = await tx.stockWriteOff.updateMany({ where: { id: request.id, status: 'SUBMITTED' }, data: {
            status: decision, reviewedById: actor.id, reviewedAt: new Date(), reviewNote,
        } });
        if (claim.count !== 1) throw new WriteOffError('Chứng từ đã được xử lý; tải lại.', 409);
        if (decision === 'POSTED') {
            for (const line of [...request.lines].sort((a,b) => a.ingredientId.localeCompare(b.ingredientId))) {
                if (line.ingredient.unit === 'piece' && !line.quantity.isInteger())
                    throw new WriteOffError('Đơn vị cái phải là số nguyên.', 409);
                if (place.type === 'BRANCH') {
                    const changed = await tx.inventoryBalance.updateMany({ where: {
                        branchId: place.id, ingredientId: line.ingredientId, quantity: { gte: line.quantity },
                    }, data: { quantity: { decrement: line.quantity } } });
                    if (changed.count !== 1) throw new WriteOffError('Tồn quầy không đủ; không ghi giảm một phần.', 409);
                    const result = await tx.inventoryBalance.findUniqueOrThrow({ where: {
                        branchId_ingredientId: { branchId: place.id, ingredientId: line.ingredientId },
                    }, select: { quantity: true } });
                    await tx.inventoryMovement.create({ data: { branchId: place.id, ingredientId: line.ingredientId,
                        actorId: actor.id, kind: 'WRITE_OFF', sourceId: request.id,
                        delta: line.quantity.negated(), quantityAfter: result.quantity } });
                } else {
                    const changed = await tx.warehouseInventoryBalance.updateMany({ where: {
                        warehouseId: place.id, ingredientId: line.ingredientId, quantity: { gte: line.quantity },
                    }, data: { quantity: { decrement: line.quantity } } });
                    if (changed.count !== 1) throw new WriteOffError('Tồn kho trung tâm không đủ; không ghi giảm một phần.', 409);
                    const result = await tx.warehouseInventoryBalance.findUniqueOrThrow({ where: {
                        warehouseId_ingredientId: { warehouseId: place.id, ingredientId: line.ingredientId },
                    }, select: { quantity: true } });
                    await tx.warehouseInventoryMovement.create({ data: { warehouseId: place.id, ingredientId: line.ingredientId,
                        actorId: actor.id, kind: 'WRITE_OFF', sourceId: request.id,
                        delta: line.quantity.negated(), quantityAfter: result.quantity } });
                }
            }
            if (place.type === 'BRANCH') await tx.branch.update({ where: { id: place.id }, data: {
                inventoryRevision: { increment: 1 }, receivingRevision: { increment: 1 },
            } });
        }
        await tx.stockWriteOffEvent.create({ data: { writeOffId: request.id, actorId: actor.id,
            action: decision, note: reviewNote } });
        return detail(tx, actor, request.id);
    }, txOptions);
}
export function writeOffFailure(error: unknown) {
    if (error instanceof WriteOffError) return { status: error.status, message: error.message };
    if (isReceivingTransactionConflict(error) || ['P2002','P2003','P2025','P2034'].includes(prismaErrorCode(error) ?? ''))
        return { status: 409, message: 'Dữ liệu tồn đã thay đổi; tải lại chứng từ và kiểm tra trước khi gửi tiếp.' };
    return { status: 503, message: 'Không thể xử lý chứng từ G8. Hãy kiểm tra trạng thái trên hệ thống.' };
}
