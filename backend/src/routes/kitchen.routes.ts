import { Router, type Response } from 'express';
import { type PrismaClient } from '../generated/prisma/client';
import { UUID_RE, readBody, onlyKeys } from '../utils/admin-api';
import {
    assertKitchenAccess, parseHeader, parseKitchenLines,
    postKitchenReceipt, postProductionBatch, kitchenFailure,
    kitchenReceiptSelect, kitchenBatchSelect,
    KitchenError, type KitchenActor,
} from '../services/kitchen.service';

function actorOf(res: Response): KitchenActor { return res.locals.authUser as KitchenActor; }
function fail(res: Response, error: unknown) {
    const failure = kitchenFailure(error);
    res.status(failure.status).json({ error: failure.message });
}
function admin(res: Response): boolean {
    if (actorOf(res)?.role === 'ADMIN') return true;
    res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
    return false;
}
const validCode = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export function createKitchenRouter(prisma: PrismaClient) {
    const router = Router();

    router.get('/warehouses', async (_req, res) => {
        try {
            const actor = actorOf(res);
            if (actor.role !== 'ADMIN' && !(actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY')) {
                return void res.json({ items: [] });
            }
            const items = await prisma.warehouse.findMany({
                where: actor.role === 'ADMIN' ? {} : { isActive: true, workers: { some: { userId: actor.id, isActive: true } } },
                select: { id: true, code: true, name: true, address: true, isActive: true },
                orderBy: { code: 'asc' }, take: 100,
            });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.post('/warehouses', async (req, res) => {
        if (!admin(res)) return;
        const body = readBody(req.body);
        if (!body || !onlyKeys(body, ['code', 'name', 'address']) ||
            typeof body.code !== 'string' || typeof body.name !== 'string') {
            return void res.status(400).json({ error: 'Thông tin kho không hợp lệ.' });
        }
        const code = body.code.trim().toUpperCase();
        const name = body.name.trim();
        const address = body.address === undefined || body.address === '' ? null : body.address;
        if (!validCode.test(code) || !name || name.length > 150 || (address !== null && (typeof address !== 'string' || !address.trim() || address.length > 255))) {
            return void res.status(400).json({ error: 'Mã, tên hoặc địa chỉ kho không hợp lệ.' });
        }
        try {
            const data = await prisma.warehouse.create({ data: { code, name, address: address as string | null },
                select: { id: true, code: true, name: true, address: true, isActive: true } });
            res.status(201).json({ data });
        } catch (error) { fail(res, error); }
    });

    router.get('/workers', async (_req, res) => {
        if (!admin(res)) return;
        try {
            const items = await prisma.user.findMany({ where: { role: 'STAFF', workKind: 'KITCHEN_DELIVERY', isActive: true, areaId: null },
                select: { id: true, displayName: true, email: true }, orderBy: { displayName: 'asc' }, take: 500 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.get('/warehouses/:id/workers', async (req, res) => {
        if (!admin(res)) return;
        if (!UUID_RE.test(req.params.id)) return void res.status(400).json({ error: 'Mã kho không hợp lệ.' });
        try {
            const items = await prisma.warehouseWorkerAssignment.findMany({ where: { warehouseId: req.params.id },
                select: { userId: true, isActive: true, user: { select: { displayName: true, email: true } } },
                orderBy: { createdAt: 'asc' }, take: 500 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.post('/warehouses/:id/workers', async (req, res) => {
        if (!admin(res)) return;
        const body = readBody(req.body);
        if (!UUID_RE.test(req.params.id) || !body || !onlyKeys(body, ['userId']) ||
            typeof body.userId !== 'string' || !UUID_RE.test(body.userId)) {
            return void res.status(400).json({ error: 'Kho hoặc nhân viên không hợp lệ.' });
        }
        try {
            const [warehouse, user] = await Promise.all([
                prisma.warehouse.findUnique({ where: { id: req.params.id }, select: { isActive: true } }),
                prisma.user.findUnique({ where: { id: body.userId as string }, select: { role: true, workKind: true, areaId: true, isActive: true } }),
            ]);
            if (!warehouse?.isActive || !user?.isActive || user.role !== 'STAFF' || user.workKind !== 'KITCHEN_DELIVERY' || user.areaId) {
                throw new KitchenError('Chỉ được gán nhân viên kho/giao hàng đang hoạt động và không thuộc khu vực bán hàng.', 409);
            }
            const data = await prisma.warehouseWorkerAssignment.upsert({
                where: { warehouseId_userId: { warehouseId: req.params.id, userId: body.userId as string } },
                update: { isActive: true }, create: { warehouseId: req.params.id, userId: body.userId as string, isActive: true },
            });
            res.json({ data });
        } catch (error) { fail(res, error); }
    });

    router.patch('/warehouses/:id/workers/:userId', async (req, res) => {
        if (!admin(res)) return;
        const body = readBody(req.body);
        if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.userId) || !body || !onlyKeys(body, ['isActive']) || typeof body.isActive !== 'boolean') {
            return void res.status(400).json({ error: 'Dữ liệu phân công không hợp lệ.' });
        }
        try {
            const result = await prisma.warehouseWorkerAssignment.updateMany({
                where: { warehouseId: req.params.id, userId: req.params.userId }, data: { isActive: body.isActive },
            });
            if (!result.count) return void res.status(404).json({ error: 'Chưa có phân công nhân viên tại kho.' });
            res.json({ data: { isActive: body.isActive } });
        } catch (error) { fail(res, error); }
    });

    router.get('/ingredients', async (_req, res) => {
        const actor = actorOf(res);
        if (actor.role !== 'ADMIN' && !(actor.role === 'STAFF' && actor.workKind === 'KITCHEN_DELIVERY')) {
            return void res.status(403).json({ error: 'Không có quyền xem danh mục kho bếp.' });
        }
        try {
            const items = await prisma.ingredient.findMany({ where: { isActive: true },
                select: { id: true, code: true, name: true, unit: true }, orderBy: { code: 'asc' }, take: 1000 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.get('/warehouses/:id/balances', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const items = await prisma.warehouseInventoryBalance.findMany({ where: { warehouseId: req.params.id },
                select: { ingredientId: true, quantity: true, updatedAt: true,
                    ingredient: { select: { code: true, name: true, unit: true } } },
                orderBy: { ingredientId: 'asc' }, take: 1000 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.get('/warehouses/:id/movements', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const items = await prisma.warehouseInventoryMovement.findMany({ where: { warehouseId: req.params.id },
                select: { id: true, kind: true, sourceId: true, ingredientId: true, delta: true, quantityAfter: true, createdAt: true,
                    ingredient: { select: { code: true, name: true, unit: true } } },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.get('/warehouses/:id/receipts', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const items = await prisma.warehouseReceipt.findMany({ where: { warehouseId: req.params.id },
                select: kitchenReceiptSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.post('/warehouses/:id/receipts', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const { body, code, note, supplierName } = parseHeader(req.body, true);
            const items = await parseKitchenLines(prisma, body.items, true);
            const data = await prisma.warehouseReceipt.create({ data: { warehouseId: req.params.id, code, note, supplierName,
                createdById: actorOf(res).id, items: { create: items.map(item => ({ ingredientId: item.ingredientId,
                    quantity: item.quantity, unitCost: item.unitCost! })) } }, select: kitchenReceiptSelect });
            res.status(201).json({ data });
        } catch (error) { fail(res, error); }
    });

    router.post('/receipts/:id/post', async (req, res) => {
        try {
            if (req.body && Object.keys(req.body).length) throw new KitchenError('Yêu cầu ghi sổ không có body.', 400);
            const data = await postKitchenReceipt(prisma, actorOf(res), req.params.id);
            res.json({ data });
        } catch (error) { fail(res, error); }
    });

    router.get('/warehouses/:id/batches', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const items = await prisma.productionBatch.findMany({ where: { warehouseId: req.params.id },
                select: kitchenBatchSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
            res.json({ items });
        } catch (error) { fail(res, error); }
    });

    router.post('/warehouses/:id/batches', async (req, res) => {
        try {
            await assertKitchenAccess(prisma, actorOf(res), req.params.id);
            const { body, code, note } = parseHeader(req.body, false);
            const [inputs, outputs] = await Promise.all([
                parseKitchenLines(prisma, body.inputs, false),
                parseKitchenLines(prisma, body.outputs, false),
            ]);
            const inputIds = new Set(inputs.map(row => row.ingredientId));
            if (outputs.some(row => inputIds.has(row.ingredientId))) {
                throw new KitchenError('Không được dùng cùng SKU làm đầu vào và đầu ra trong một mẻ.', 400);
            }
            const data = await prisma.productionBatch.create({ data: { warehouseId: req.params.id, code, note,
                createdById: actorOf(res).id,
                inputs: { create: inputs.map(row => ({ ingredientId: row.ingredientId, quantity: row.quantity })) },
                outputs: { create: outputs.map(row => ({ ingredientId: row.ingredientId, quantity: row.quantity })) },
            }, select: kitchenBatchSelect });
            res.status(201).json({ data });
        } catch (error) { fail(res, error); }
    });

    router.post('/batches/:id/post', async (req, res) => {
        try {
            if (req.body && Object.keys(req.body).length) throw new KitchenError('Yêu cầu ghi sổ không có body.', 400);
            const data = await postProductionBatch(prisma, actorOf(res), req.params.id);
            res.json({ data });
        } catch (error) { fail(res, error); }
    });

    return router;
}
