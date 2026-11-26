import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { UUID_RE, onlyKeys, readBody, prismaErrorCode } from '../utils/admin-api';

export type KitchenActor = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    workKind: string;
};

export class KitchenError extends Error {
    constructor(message: string, public readonly status = 409) {
        super(message);
        this.name = 'KitchenError';
    }
}

const txOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 30000,
};

export const kitchenReceiptSelect = {
    id: true, code: true, warehouseId: true, supplierName: true, note: true,
    status: true, createdById: true, postedById: true, postedAt: true, createdAt: true,
    items: { select: { id: true, ingredientId: true, quantity: true, unitCost: true }, orderBy: { ingredientId: 'asc' } },
} as const;

export const kitchenBatchSelect = {
    id: true, code: true, warehouseId: true, note: true,
    status: true, createdById: true, postedById: true, postedAt: true, createdAt: true,
    inputs: { select: { id: true, ingredientId: true, quantity: true }, orderBy: { ingredientId: 'asc' } },
    outputs: { select: { id: true, ingredientId: true, quantity: true }, orderBy: { ingredientId: 'asc' } },
} as const;

const quantityPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const pricePattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const codePattern = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

function stringField(value: unknown, length: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > length) throw new KitchenError('Trường văn bản không hợp lệ.', 400);
    return value.trim() || null;
}

export function parseHeader(value: unknown, hasSupplier: boolean) {
    const body = readBody(value);
    if (!body || !onlyKeys(body, hasSupplier ? ['code', 'note', 'supplierName', 'items'] : ['code', 'note', 'inputs', 'outputs']) || typeof body.code !== 'string') {
        throw new KitchenError('Dữ liệu chứng từ không hợp lệ.', 400);
    }
    const code = body.code.trim().toUpperCase();
    if (!codePattern.test(code)) throw new KitchenError('Mã chứng từ gồm 2–40 ký tự chữ in hoa, số, _ hoặc -.', 400);
    return { body, code, note: stringField(body.note, 500), supplierName: stringField(body.supplierName, 160) };
}

export type KitchenLine = { ingredientId: string; quantity: string; unitCost?: string };

export async function parseKitchenLines(prisma: PrismaClient | Prisma.TransactionClient, input: unknown, hasCost: boolean): Promise<KitchenLine[]> {
    if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
        throw new KitchenError('Cần 1–50 nguyên liệu/thành phẩm trong chứng từ.', 400);
    }
    const parsed: KitchenLine[] = input.map(row => {
        const body = readBody(row);
        if (!body || !onlyKeys(body, hasCost ? ['ingredientId', 'quantity', 'unitCost'] : ['ingredientId', 'quantity'])
            || typeof body.ingredientId !== 'string' || !UUID_RE.test(body.ingredientId)
            || typeof body.quantity !== 'string' || !quantityPattern.test(body.quantity)
            || new Prisma.Decimal(body.quantity).lte(0)) {
            throw new KitchenError('Mã nguyên liệu hoặc số lượng không hợp lệ.', 400);
        }
        if (hasCost && (typeof body.unitCost !== 'string' || !pricePattern.test(body.unitCost))) {
            throw new KitchenError('Đơn giá nhập phải là chuỗi thập phân không âm.', 400);
        }
        return { ingredientId: body.ingredientId.toLowerCase(), quantity: body.quantity,
            ...(hasCost ? { unitCost: body.unitCost as string } : {}) };
    });
    const ids = parsed.map(row => row.ingredientId);
    if (new Set(ids).size !== ids.length) throw new KitchenError('Không được lặp nguyên liệu trong cùng một nhóm.', 400);
    const ingredients = await prisma.ingredient.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, unit: true } });
    if (ingredients.length !== ids.length) throw new KitchenError('Có nguyên liệu không tồn tại hoặc đã vô hiệu hóa.', 409);
    const units = new Map(ingredients.map(row => [row.id, row.unit]));
    if (parsed.some(row => units.get(row.ingredientId) === 'piece' && !/^\d+$/.test(row.quantity))) {
        throw new KitchenError('Mặt hàng tính theo cái phải có số lượng nguyên.', 400);
    }
    return parsed;
}

export async function assertKitchenAccess(db: PrismaClient | Prisma.TransactionClient,
    actor: KitchenActor, warehouseId: string): Promise<void> {
    if (!UUID_RE.test(warehouseId)) throw new KitchenError('Mã kho không hợp lệ.', 400);
    const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { isActive: true } });
    if (!warehouse?.isActive) throw new KitchenError('Kho không tồn tại hoặc đã ngừng hoạt động.', 404);
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'STAFF' || actor.workKind !== 'KITCHEN_DELIVERY') {
        throw new KitchenError('Tài khoản không được thao tác tại kho trung tâm.', 403);
    }
    const assignment = await db.warehouseWorkerAssignment.findUnique({
        where: { warehouseId_userId: { warehouseId, userId: actor.id } },
        select: { isActive: true },
    });
    if (!assignment?.isActive) throw new KitchenError('Nhân viên chưa được phân công đến kho này.', 403);
}

async function updateKitchenBalance(tx: Prisma.TransactionClient,
    input: { warehouseId: string; ingredientId: string; actorId: string; sourceId: string;
        kind: 'RECEIPT' | 'PRODUCTION_INPUT' | 'PRODUCTION_OUTPUT'; delta: Prisma.Decimal }) {
    const key = { warehouseId: input.warehouseId, ingredientId: input.ingredientId };
    let quantityAfter: Prisma.Decimal;
    if (input.delta.lt(0)) {
        const updated = await tx.warehouseInventoryBalance.updateMany({
            where: { ...key, quantity: { gte: input.delta.negated() } },
            data: { quantity: { decrement: input.delta.negated() } },
        });
        if (updated.count !== 1) throw new KitchenError('Kho không đủ tồn để thực hiện mẻ pha chế.', 409);
        const balance = await tx.warehouseInventoryBalance.findUniqueOrThrow({ where: { warehouseId_ingredientId: key } });
        quantityAfter = balance.quantity;
    } else {
        const balance = await tx.warehouseInventoryBalance.upsert({
            where: { warehouseId_ingredientId: key },
            create: { ...key, quantity: input.delta },
            update: { quantity: { increment: input.delta } },
        });
        quantityAfter = balance.quantity;
    }
    await tx.warehouseInventoryMovement.create({ data: {
        ...key, actorId: input.actorId, kind: input.kind,
        sourceId: input.sourceId, delta: input.delta, quantityAfter,
    } });
}

export async function postKitchenReceipt(prisma: PrismaClient, actor: KitchenActor, receiptId: string) {
    if (!UUID_RE.test(receiptId)) throw new KitchenError('Mã phiếu nhập không hợp lệ.', 400);
    return prisma.$transaction(async tx => {
        const receipt = await tx.warehouseReceipt.findUnique({ where: { id: receiptId }, include: { items: true } });
        if (!receipt) throw new KitchenError('Không tìm thấy phiếu nhập.', 404);
        await assertKitchenAccess(tx, actor, receipt.warehouseId);
        if (receipt.status !== 'DRAFT' || receipt.items.length === 0) throw new KitchenError('Phiếu đã ghi sổ hoặc không có dòng nhập.', 409);
        const claimed = await tx.warehouseReceipt.updateMany({ where: { id: receipt.id, status: 'DRAFT' },
            data: { status: 'POSTED', postedById: actor.id, postedAt: new Date() } });
        if (claimed.count !== 1) throw new KitchenError('Phiếu đã được ghi sổ.', 409);
        for (const item of receipt.items.slice().sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
            await updateKitchenBalance(tx, { warehouseId: receipt.warehouseId, ingredientId: item.ingredientId,
                actorId: actor.id, sourceId: receipt.id, kind: 'RECEIPT', delta: item.quantity });
        }
        return tx.warehouseReceipt.findUniqueOrThrow({ where: { id: receipt.id }, select: kitchenReceiptSelect });
    }, txOptions);
}

export async function postProductionBatch(prisma: PrismaClient, actor: KitchenActor, batchId: string) {
    if (!UUID_RE.test(batchId)) throw new KitchenError('Mã mẻ pha chế không hợp lệ.', 400);
    return prisma.$transaction(async tx => {
        const batch = await tx.productionBatch.findUnique({ where: { id: batchId }, include: { inputs: true, outputs: true } });
        if (!batch) throw new KitchenError('Không tìm thấy mẻ pha chế.', 404);
        await assertKitchenAccess(tx, actor, batch.warehouseId);
        if (batch.status !== 'DRAFT' || !batch.inputs.length || !batch.outputs.length) throw new KitchenError('Mẻ đã ghi sổ hoặc thiếu nguyên liệu/thành phẩm.', 409);
        const ids = [...batch.inputs.map(row => row.ingredientId), ...batch.outputs.map(row => row.ingredientId)];
        const usable = await tx.ingredient.count({ where: { id: { in: ids }, isActive: true } });
        if (usable !== ids.length) throw new KitchenError('Có nguyên liệu hoặc thành phẩm đã ngừng hoạt động.', 409);
        const claimed = await tx.productionBatch.updateMany({ where: { id: batch.id, status: 'DRAFT' },
            data: { status: 'POSTED', postedById: actor.id, postedAt: new Date() } });
        if (claimed.count !== 1) throw new KitchenError('Mẻ đã ghi sổ.', 409);
        for (const item of batch.inputs.slice().sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
            await updateKitchenBalance(tx, { warehouseId: batch.warehouseId, ingredientId: item.ingredientId,
                actorId: actor.id, sourceId: batch.id, kind: 'PRODUCTION_INPUT', delta: item.quantity.negated() });
        }
        for (const item of batch.outputs.slice().sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
            await updateKitchenBalance(tx, { warehouseId: batch.warehouseId, ingredientId: item.ingredientId,
                actorId: actor.id, sourceId: batch.id, kind: 'PRODUCTION_OUTPUT', delta: item.quantity });
        }
        return tx.productionBatch.findUniqueOrThrow({ where: { id: batch.id }, select: kitchenBatchSelect });
    }, txOptions);
}

export function kitchenFailure(error: unknown): { status: number; message: string } {
    if (error instanceof KitchenError) return { status: error.status, message: error.message };
    const code = prismaErrorCode(error);
    if (code === 'P2002' || code === 'P2034') return { status: 409, message: 'Trùng chứng từ hoặc dữ liệu tồn kho thay đổi đồng thời. Hãy tải lại và đối chiếu.' };
    if (code === 'P2025') return { status: 404, message: 'Không tìm thấy dữ liệu kho cần cập nhật.' };
    return { status: 503, message: 'Dữ liệu kho bếp hiện không khả dụng. Hãy đối chiếu trước khi gửi lại.' };
}
