import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { onlyKeys, readBody, UUID_RE, prismaErrorCode } from '../utils/admin-api';
import { assertKitchenAccess, parseKitchenLines, type KitchenActor, KitchenError } from './kitchen.service';
import { operationalBranchIds, type OperationalActor } from './operational-access.service';
import { lockReceivingBranches, isReceivingTransactionConflict } from './receiving-guard.service';

export type DistributionActor = OperationalActor & KitchenActor;
export class DistributionError extends Error {
    constructor(message: string, public readonly status = 409) { super(message); }
}
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 };
const codePattern = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const numberPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const tripSelect = {
    id: true, code: true, warehouseId: true, businessDate: true, courierId: true,
    status: true, note: true, receivedStops: true, createdAt: true, dispatchedAt: true, completedAt: true,
    warehouse: { select: { code: true, name: true } },
    courier: { select: { displayName: true } },
    stops: { orderBy: { stopOrder: 'asc' }, select: {
        id: true, branchId: true, stopOrder: true, status: true, receivedAt: true, note: true,
        branch: { select: { code: true, name: true, areaId: true } },
        items: { orderBy: { ingredientId: 'asc' }, select: {
            ingredientId: true, plannedQuantity: true, receivedQuantity: true, damagedQuantity: true,
            ingredient: { select: { code: true, name: true, unit: true } },
        } },
    } },
} as const;

function id(value: unknown): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new DistributionError('ID không hợp lệ.', 400);
    return value.toLowerCase();
}
function date(value: unknown): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DistributionError('Ngày phải là YYYY-MM-DD.', 400);
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new DistributionError('Ngày không hợp lệ.', 400);
    return parsed;
}
function note(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > 500) throw new DistributionError('Ghi chú tối đa 500 ký tự.', 400);
    return value.trim() || null;
}
function decimal(value: unknown, allowZero = true): Prisma.Decimal {
    if (typeof value !== 'string' || !numberPattern.test(value)) throw new DistributionError('Số lượng phải là chuỗi thập phân hợp lệ.', 400);
    const num = new Prisma.Decimal(value);
    if (num.lt(0) || (!allowZero && num.lte(0))) throw new DistributionError('Số lượng phải dương.', 400);
    return num;
}
const localDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (key: string) => parts.find(item => item.type === key)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};

async function warehouseIds(prisma: PrismaClient, actor: DistributionActor): Promise<string[]> {
    if (actor.role === 'ADMIN') return (await prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true } })).map(x => x.id);
    if (actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY') {
        return (await prisma.warehouseWorkerAssignment.findMany({
            where: { userId: actor.id, isActive: true, warehouse: { isActive: true } }, select: { warehouseId: true },
        })).map(x => x.warehouseId);
    }
    return [];
}

export async function distributionBranches(prisma: PrismaClient, actor: DistributionActor, businessDate?: string) {
    if (actor.role === 'ADMIN' || (actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY')) {
        if (actor.role !== 'ADMIN' && !(await warehouseIds(prisma, actor)).length) return [];
        return prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 500 });
    }
    const ids = await operationalBranchIds(prisma, actor, date(businessDate ?? localDate()), 'MORNING');
    return prisma.branch.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
}

export async function listDistributionTrips(prisma: PrismaClient, actor: DistributionActor, businessDate: string) {
    const at = date(businessDate);
    const kitchen = actor.role === 'ADMIN' || (actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY');
    const ids = kitchen ? await warehouseIds(prisma, actor) : await operationalBranchIds(prisma, actor, at, 'MORNING');
    if (!ids.length) return [];
    const trips = await prisma.deliveryTrip.findMany({ where: {
        businessDate: at,
        ...(kitchen ? { warehouseId: { in: ids } } : { stops: { some: { branchId: { in: ids } } } }),
    }, select: tripSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    return trips.map(trip => ({ ...trip, stops: kitchen ? trip.stops : trip.stops.filter(s => ids.includes(s.branchId)) }));
}

export async function getDistributionTrip(prisma: PrismaClient, actor: DistributionActor, tripId: string) {
    const trip = await prisma.deliveryTrip.findUnique({ where: { id: id(tripId) }, select: tripSelect });
    if (!trip) throw new DistributionError('Không tìm thấy chuyến giao.', 404);
    const kitchen = actor.role === 'ADMIN' || (actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY');
    const ids = kitchen ? await warehouseIds(prisma, actor)
        : await operationalBranchIds(prisma, actor, trip.businessDate, 'MORNING');
    const authorized = kitchen ? ids.includes(trip.warehouseId) : trip.stops.some(stop => ids.includes(stop.branchId));
    if (!authorized) throw new DistributionError('Không có quyền xem chuyến giao.', 403);
    return { ...trip, stops: kitchen ? trip.stops : trip.stops.filter(stop => ids.includes(stop.branchId)) };
}

export async function createDistributionTrip(prisma: PrismaClient, actor: DistributionActor, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['code', 'warehouseId', 'businessDate', 'courierId', 'note', 'stops']))
        throw new DistributionError('Dữ liệu chuyến giao không hợp lệ.', 400);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!codePattern.test(code)) throw new DistributionError('Mã chuyến không hợp lệ.', 400);
    const warehouseId = id(body.warehouseId);
    const businessDate = date(body.businessDate);
    const courierId = body.courierId == null || body.courierId === '' ? null : id(body.courierId);
    if (!courierId) throw new DistributionError('Phải phân công nhân viên giao hàng trước khi lập chuyến.', 400);
    const memo = note(body.note);
    await assertKitchenAccess(prisma, actor, warehouseId);
    if (actor.role === 'STAFF' && courierId !== actor.id) throw new DistributionError('Nhân viên kho chỉ được lập chuyến do chính mình phụ trách.', 403);
    if (courierId) {
        const courier = await prisma.user.findFirst({ where: { id: courierId, isActive: true,
            role: 'STAFF', workKind: 'KITCHEN_DELIVERY',
            warehouseWorkerAssignments: { some: { warehouseId, isActive: true } },
        }, select: { id: true } });
        if (!courier) throw new DistributionError('Người giao chưa được phân công tại kho này.', 409);
    }
    if (!Array.isArray(body.stops) || body.stops.length < 1 || body.stops.length > 25)
        throw new DistributionError('Một chuyến cần từ 1 đến 25 điểm giao.', 400);
    const parsedStops = [] as { branchId: string; stopOrder: number; items: { ingredientId: string; quantity: string }[] }[];
    for (const [i, raw] of body.stops.entries()) {
        const stop = readBody(raw);
        if (!stop || !onlyKeys(stop, ['branchId', 'items'])) throw new DistributionError('Điểm giao không hợp lệ.', 400);
        const branchId = id(stop.branchId);
        const items = await parseKitchenLines(prisma, stop.items, false);
        parsedStops.push({ branchId, stopOrder: i + 1, items });
    }
    const branchIds = parsedStops.map(stop => stop.branchId);
    if (new Set(branchIds).size !== branchIds.length) throw new DistributionError('Một quầy không được xuất hiện hai lần trong cùng chuyến.', 400);
    const branches = await prisma.branch.count({ where: { id: { in: branchIds }, isActive: true } });
    if (branches !== branchIds.length) throw new DistributionError('Có quầy không hoạt động hoặc không tồn tại.', 409);
    return prisma.deliveryTrip.create({ data: {
        code, warehouseId, businessDate, courierId, note: memo, createdById: actor.id,
        stops: { create: parsedStops.map(stop => ({ branchId: stop.branchId, stopOrder: stop.stopOrder,
            items: { create: stop.items.map(item => ({ ingredientId: item.ingredientId, plannedQuantity: item.quantity })) },
        })) },
    }, select: tripSelect });
}

export async function dispatchDistributionTrip(prisma: PrismaClient, actor: DistributionActor, tripId: string) {
    return prisma.$transaction(async tx => {
        const trip = await tx.deliveryTrip.findUnique({ where: { id: id(tripId) },
            include: { stops: { include: { items: true } } } });
        if (!trip) throw new DistributionError('Không tìm thấy chuyến giao.', 404);
        await assertKitchenAccess(tx, actor, trip.warehouseId);
        if (actor.role === 'STAFF' && trip.courierId !== actor.id) throw new DistributionError('Chuyến này không được phân công cho bạn.', 403);
        if (trip.status !== 'DRAFT') throw new DistributionError('Chuyến không còn ở trạng thái nháp. Hãy tải lại trước khi thao tác.', 409);
        if (!trip.stops.length) throw new DistributionError('Chuyến chưa có điểm giao.', 409);
        const byIngredient = new Map<string, Prisma.Decimal>();
        for (const stop of trip.stops) for (const item of stop.items) {
            const previous = byIngredient.get(item.ingredientId) ?? new Prisma.Decimal(0);
            byIngredient.set(item.ingredientId, previous.plus(item.plannedQuantity));
        }
        // Synchronize dispatch with branch receiving/closing to prevent a stale shift count.
        await lockReceivingBranches(tx, trip.stops.map(stop => stop.branchId));
        const claimed = await tx.deliveryTrip.updateMany({ where: { id: trip.id, status: 'DRAFT' },
            data: { status: 'IN_TRANSIT', dispatchedById: actor.id, dispatchedAt: new Date() } });
        if (claimed.count !== 1) throw new DistributionError('Có người khác đã xuất chuyến này.', 409);
        for (const [ingredientId, quantity] of [...byIngredient].sort(([a], [b]) => a.localeCompare(b))) {
            const changed = await tx.warehouseInventoryBalance.updateMany({
                where: { warehouseId: trip.warehouseId, ingredientId, quantity: { gte: quantity } },
                data: { quantity: { decrement: quantity } },
            });
            if (changed.count !== 1) throw new DistributionError('Kho trung tâm không đủ tồn để xuất chuyến.', 409);
            const balance = await tx.warehouseInventoryBalance.findUniqueOrThrow({
                where: { warehouseId_ingredientId: { warehouseId: trip.warehouseId, ingredientId } },
                select: { quantity: true },
            });
            await tx.warehouseInventoryMovement.create({ data: {
                warehouseId: trip.warehouseId, ingredientId, actorId: actor.id,
                kind: 'DISTRIBUTION', sourceId: trip.id, delta: quantity.negated(), quantityAfter: balance.quantity,
            } });
        }
        await tx.deliveryStop.updateMany({ where: { tripId: trip.id, status: 'PLANNED' }, data: { status: 'DISPATCHED' } });
        return tx.deliveryTrip.findUniqueOrThrow({ where: { id: trip.id }, select: tripSelect });
    }, txOptions);
}

export async function receiveDistributionStop(prisma: PrismaClient, actor: DistributionActor,
    stopId: string, input: unknown) {
    const body = readBody(input);
    if (!body || !onlyKeys(body, ['items', 'note']) || !Array.isArray(body.items))
        throw new DistributionError('Dữ liệu nhận hàng không hợp lệ.', 400);
    const memo = note(body.note);
    return prisma.$transaction(async tx => {
        const stop = await tx.deliveryStop.findUnique({ where: { id: id(stopId) },
            include: { trip: { select: { id: true, status: true, businessDate: true, stops: { select: { id: true } } } },
                items: { include: { ingredient: { select: { unit: true } } } } } });
        if (!stop) throw new DistributionError('Không tìm thấy điểm giao.', 404);
        if (actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY') throw new DistributionError('Nhân viên kho không được tự xác nhận nhận hàng tại quầy.', 403);
        const permitted = await operationalBranchIds(tx, actor, stop.trip.businessDate, 'MORNING');
        if (!permitted.includes(stop.branchId)) throw new DistributionError('Bạn không được phân công nhận hàng tại quầy này.', 403);
        if (stop.trip.status !== 'IN_TRANSIT' || stop.status !== 'DISPATCHED')
            throw new DistributionError('Điểm giao chưa xuất kho hoặc đã xác nhận. Hãy tải lại.', 409);
        if (body.items.length !== stop.items.length) throw new DistributionError('Phải nhập đầy đủ mọi SKU tại điểm giao.', 400);
        const amounts = new Map<string, { received: Prisma.Decimal; damaged: Prisma.Decimal }>();
        for (const raw of body.items) {
            const item = readBody(raw);
            if (!item || !onlyKeys(item, ['ingredientId', 'receivedQuantity', 'damagedQuantity']))
                throw new DistributionError('Dòng nhận hàng không hợp lệ.', 400);
            const ingredientId = id(item.ingredientId);
            if (amounts.has(ingredientId)) throw new DistributionError('Trùng SKU trong phiếu nhận.', 400);
            amounts.set(ingredientId, { received: decimal(item.receivedQuantity), damaged: decimal(item.damagedQuantity) });
        }
        let hasDiscrepancy = false;
        for (const item of stop.items) {
            const entry = amounts.get(item.ingredientId);
            if (!entry) throw new DistributionError('Có SKU chưa được nhập nhận.', 400);
            if (entry.received.plus(entry.damaged).gt(item.plannedQuantity)) throw new DistributionError('Thực nhận + hỏng vượt số lượng giao.', 400);
            if (item.ingredient.unit === 'piece' && (!entry.received.isInteger() || !entry.damaged.isInteger()))
                throw new DistributionError('Mặt hàng tính theo cái cần số lượng nguyên.', 400);
            if (!entry.received.eq(item.plannedQuantity) || !entry.damaged.isZero()) hasDiscrepancy = true;
        }
        if (hasDiscrepancy && !memo) throw new DistributionError('Hàng thiếu hoặc hỏng phải có ghi chú giải trình.', 400);
        // Serialize receiving with the existing B6 receiving/count write barrier.
        await lockReceivingBranches(tx, [stop.branchId]);
        const claimed = await tx.deliveryStop.updateMany({ where: { id: stop.id, status: 'DISPATCHED' },
            data: { status: 'RECEIVED', note: memo, receivedById: actor.id, receivedAt: new Date() } });
        if (claimed.count !== 1) throw new DistributionError('Điểm giao đã được người khác xác nhận.', 409);
        for (const item of [...stop.items].sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
            const entry = amounts.get(item.ingredientId)!;
            await tx.deliveryStopItem.update({ where: { stopId_ingredientId: { stopId: stop.id, ingredientId: item.ingredientId } },
                data: { receivedQuantity: entry.received, damagedQuantity: entry.damaged } });
            if (entry.received.isZero()) continue;
            const balance = await tx.inventoryBalance.upsert({
                where: { branchId_ingredientId: { branchId: stop.branchId, ingredientId: item.ingredientId } },
                create: { branchId: stop.branchId, ingredientId: item.ingredientId, quantity: entry.received },
                update: { quantity: { increment: entry.received } },
            });
            await tx.inventoryMovement.create({ data: {
                branchId: stop.branchId, ingredientId: item.ingredientId, actorId: actor.id,
                kind: 'TRANSFER_IN', sourceId: stop.id, delta: entry.received, quantityAfter: balance.quantity,
            } });
        }
        await tx.branch.update({ where: { id: stop.branchId }, data: {
            receivingRevision: { increment: 1 }, inventoryRevision: { increment: 1 },
        } });
        // A trip row write prevents concurrent last-stop races at Serializable isolation.
        const updatedTrip = await tx.deliveryTrip.update({ where: { id: stop.trip.id }, data: { receivedStops: { increment: 1 } } });
        if (updatedTrip.receivedStops === stop.trip.stops.length) {
            await tx.deliveryTrip.update({ where: { id: stop.trip.id }, data: { status: 'COMPLETE', completedAt: new Date() } });
        }
        return tx.deliveryStop.findUniqueOrThrow({ where: { id: stop.id }, select: { id: true, tripId: true, status: true, receivedAt: true, note: true } });
    }, txOptions);
}

export function distributionFailure(error: unknown) {
    if (error instanceof DistributionError || error instanceof KitchenError) return { status: error.status, message: error.message };
    if (isReceivingTransactionConflict(error) || ['P2002', 'P2003', 'P2025'].includes(prismaErrorCode(error) ?? ''))
        return { status: 409, message: 'Dữ liệu đã thay đổi, hãy tải lại và đối chiếu trước khi thao tác.' };
    return { status: 503, message: 'Không thể xử lý chuyến giao. Kiểm tra trạng thái trên máy chủ trước khi thử lại.' };
}
export { localDate };
