import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { UUID_RE, prismaErrorCode, readBody, onlyKeys } from '../utils/admin-api';

type Actor = { id: string; role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF' };
const actorOf = (res: Response) => res.locals.authUser as Actor | undefined;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const sendFailure = (res: Response, error: unknown) => {
    const code = prismaErrorCode(error);
    if (code === 'P2002' || code === 'P2003') return void res.status(409).json({ error: 'Dữ liệu đã tồn tại hoặc đang được sử dụng.' });
    res.status(503).json({ error: 'Không thể truy cập dữ liệu khu vực.' });
};

/** Phạm vi dữ liệu xác định lại từ DB, không tin vào areaId truyền từ client/JWT cũ. */
async function scopeOf(prisma: PrismaClient, res: Response) {
    const actor = actorOf(res);
    if (!actor) return null;
    return prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, areaId: true, isActive: true } });
}

export function createAreasRouter(prisma: PrismaClient) {
    const router = Router();

    router.get('/', async (_req, res) => {
        try {
            const actor = await scopeOf(prisma, res);
            if (!actor?.isActive) return void res.status(403).json({ error: 'Tài khoản không hoạt động.' });
            const items = await prisma.area.findMany({
                where: actor.role === 'ADMIN' ? {} : { id: actor.areaId ?? '00000000-0000-0000-0000-000000000000' },
                select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: 'asc' }, take: 200,
            });
            res.json({ items });
        } catch (error) { sendFailure(res, error); }
    });

    router.post('/', async (req, res) => {
        const actor = actorOf(res);
        if (actor?.role !== 'ADMIN') return void res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
        const body = readBody(req.body);
        if (!body || !onlyKeys(body, ['code', 'name']) || typeof body.code !== 'string' || typeof body.name !== 'string') {
            return void res.status(400).json({ error: 'Dữ liệu khu vực không hợp lệ.' });
        }
        const code = body.code.trim().toUpperCase();
        const name = body.name.trim();
        if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code) || !name || name.length > 150) {
            return void res.status(400).json({ error: 'Mã hoặc tên khu vực không hợp lệ.' });
        }
        try {
            const data = await prisma.area.create({ data: { code, name } });
            res.status(201).json({ data });
        } catch (error) { sendFailure(res, error); }
    });

    router.patch('/:id', async (req, res) => {
        if (actorOf(res)?.role !== 'ADMIN') return void res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
        if (!isUuid(req.params.id)) return void res.status(400).json({ error: 'Mã khu vực không hợp lệ.' });
        const body = readBody(req.body);
        if (!body || !onlyKeys(body, ['name', 'isActive']) || Object.keys(body).length === 0) {
            return void res.status(400).json({ error: 'Dữ liệu cập nhật không hợp lệ.' });
        }
        const data: { name?: string; isActive?: boolean } = {};
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) {
                return void res.status(400).json({ error: 'Tên khu vực không hợp lệ.' });
            }
            data.name = body.name.trim();
        }
        if (body.isActive !== undefined) {
            if (typeof body.isActive !== 'boolean') return void res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
            data.isActive = body.isActive;
        }
        try {
            if (data.isActive === false) {
                const [branchCount, memberCount] = await Promise.all([
                    prisma.branch.count({ where: { areaId: req.params.id } }),
                    prisma.user.count({ where: { areaId: req.params.id } }),
                ]);
                if (branchCount > 0 || memberCount > 0) {
                    return void res.status(409).json({ error: 'Cần điều chuyển hết quầy và nhân viên trước khi vô hiệu hóa khu vực.' });
                }
            }
            const dataResult = await prisma.area.update({ where: { id: req.params.id }, data });
            res.json({ data: dataResult });
        } catch (error) {
            if (prismaErrorCode(error) === 'P2025') return void res.status(404).json({ error: 'Không tìm thấy khu vực.' });
            sendFailure(res, error);
        }
    });

    router.get('/:id/branches', async (req, res) => {
        if (!isUuid(req.params.id)) return void res.status(400).json({ error: 'Mã khu vực không hợp lệ.' });
        try {
            const actor = await scopeOf(prisma, res);
            if (!actor?.isActive || (actor.role !== 'ADMIN' && actor.areaId !== req.params.id)) {
                return void res.status(403).json({ error: 'Ngoài phạm vi khu vực được phân công.' });
            }
            const items = await prisma.branch.findMany({ where: { areaId: req.params.id },
                select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: 'asc' } });
            res.json({ items });
        } catch (error) { sendFailure(res, error); }
    });

    router.post('/:id/branches', async (req, res) => {
        if (actorOf(res)?.role !== 'ADMIN') return void res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
        const body = readBody(req.body);
        if (!isUuid(req.params.id) || !body || !onlyKeys(body, ['branchId']) || !isUuid(body.branchId)) {
            return void res.status(400).json({ error: 'Dữ liệu phân bổ quầy không hợp lệ.' });
        }
        try {
            const [area, branch] = await Promise.all([
                prisma.area.findUnique({ where: { id: req.params.id } }),
                prisma.branch.findUnique({ where: { id: body.branchId } }),
            ]);
            if (!area?.isActive || !branch?.isActive) return void res.status(409).json({ error: 'Khu vực hoặc quầy không hoạt động.' });
            if (branch.areaId && branch.areaId !== area.id) return void res.status(409).json({ error: 'Quầy đã thuộc khu vực khác; cần quy trình điều chuyển riêng.' });
            const data = await prisma.branch.update({ where: { id: branch.id, areaId: branch.areaId }, data: { areaId: area.id },
                select: { id: true, code: true, name: true, areaId: true } });
            res.json({ data });
        } catch (error) { sendFailure(res, error); }
    });

    router.get('/:id/users', async (req, res) => {
        if (!isUuid(req.params.id)) return void res.status(400).json({ error: 'Mã khu vực không hợp lệ.' });
        try {
            const actor = await scopeOf(prisma, res);
            if (!actor?.isActive || actor.role === 'STAFF' || (actor.role !== 'ADMIN' && actor.areaId !== req.params.id)) {
                return void res.status(403).json({ error: 'Ngoài phạm vi quản lý nhân sự.' });
            }
            const items = await prisma.user.findMany({ where: { areaId: req.params.id, isActive: true },
                select: { id: true, displayName: true, role: true, workKind: true, areaId: true },
                orderBy: { displayName: 'asc' }, take: 300 });
            res.json({ items });
        } catch (error) { sendFailure(res, error); }
    });

    // Warehouse/kitchen-delivery staff are central staff, not area-bound sales staff.
    router.post('/central-staff', async (req, res) => {
        if (actorOf(res)?.role !== 'ADMIN') return void res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
        const body = readBody(req.body);
        if (!body || !onlyKeys(body, ['userId']) || !isUuid(body.userId)) {
            return void res.status(400).json({ error: 'Nhân viên không hợp lệ.' });
        }
        try {
            const user = await prisma.user.findUnique({ where: { id: body.userId } });
            if (!user?.isActive || user.role !== 'STAFF') return void res.status(409).json({ error: 'Chỉ STAFF đang hoạt động mới thuộc nhóm kho bếp/giao hàng.' });
            const scheduled = await prisma.shiftAssignment.count({ where: { userId: user.id, status: 'SCHEDULED' } });
            if (scheduled) return void res.status(409).json({ error: 'Nhân viên vẫn có phân công quầy; cần hủy/chuyển phân công trước.' });
            const data = await prisma.user.update({ where: { id: user.id, areaId: user.areaId },
                data: { areaId: null, workKind: 'KITCHEN_DELIVERY' },
                select: { id: true, displayName: true, role: true, areaId: true, workKind: true } });
            res.json({ data });
        } catch (error) { sendFailure(res, error); }
    });

    router.post('/:id/users', async (req, res) => {
        if (actorOf(res)?.role !== 'ADMIN') return void res.status(403).json({ error: 'Yêu cầu quyền ADMIN.' });
        const body = readBody(req.body);
        if (!isUuid(req.params.id) || !body || !onlyKeys(body, ['userId', 'workKind']) || !isUuid(body.userId)
            || (body.workKind !== undefined && body.workKind !== 'SALES')) {
            return void res.status(400).json({ error: 'Dữ liệu phân công nhân viên không hợp lệ.' });
        }
        try {
            const [area, user] = await Promise.all([
                prisma.area.findUnique({ where: { id: req.params.id } }),
                prisma.user.findUnique({ where: { id: body.userId }, include: { branch: { select: { areaId: true } } } }),
            ]);
            if (!area?.isActive || !user?.isActive || user.role === 'ADMIN') {
                return void res.status(409).json({ error: 'Khu vực hoặc nhân viên không hợp lệ.' });
            }
            if (user.areaId && user.areaId !== area.id) return void res.status(409).json({ error: 'Nhân viên thuộc khu vực khác; cần chuyển khu vực riêng.' });
            if (user.branch?.areaId && user.branch.areaId !== area.id) {
                return void res.status(409).json({ error: 'Chi nhánh cũ của nhân viên chưa thuộc khu vực này.' });
            }
            const workKind = 'SALES';
            const data = await prisma.user.update({ where: { id: user.id, areaId: user.areaId },
                data: { areaId: area.id, workKind },
                select: { id: true, displayName: true, role: true, areaId: true, workKind: true } });
            res.json({ data });
        } catch (error) { sendFailure(res, error); }
    });

    return router;
}
