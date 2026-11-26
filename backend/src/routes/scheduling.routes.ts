import { Router, type Response } from 'express';
import type { Prisma, PrismaClient, WorkShift } from '../generated/prisma/client';
import { UUID_RE, onlyKeys, prismaErrorCode, readBody } from '../utils/admin-api';

type Role = 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
type Actor = { id: string; role: Role };
const SHIFT_VALUES: WorkShift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const actorId = (res: Response): string | undefined => (res.locals.authUser as Actor | undefined)?.id;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const validShift = (value: unknown): value is WorkShift => typeof value === 'string' && SHIFT_VALUES.includes(value as WorkShift);

function businessDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
function dateSpan(from: unknown, to: unknown): { from: Date; to: Date } | null {
    const start = businessDate(from), end = businessDate(to);
    if (!start || !end || end.getTime() < start.getTime() || end.getTime() - start.getTime() > 31 * 86400000) return null;
    return { from: start, to: end };
}
function handleError(res: Response, error: unknown) {
    const code = prismaErrorCode(error);
    if (code === 'P2002' || code === 'P2003') return void res.status(409).json({ error: 'Ca làm việc hoặc dữ liệu phân công đã tồn tại.' });
    res.status(503).json({ error: 'Không thể xử lý lịch làm việc.' });
}
async function actorOf(prisma: PrismaClient, res: Response) {
    const id = actorId(res);
    if (!id) return null;
    return prisma.user.findUnique({ where: { id }, select: { id: true, role: true, areaId: true, workKind: true, isActive: true } });
}
const assignmentSelect = {
    id: true, businessDate: true, shift: true, status: true, version: true, branchId: true, userId: true,
    user: { select: { id: true, displayName: true, areaId: true } },
    branch: { select: { id: true, code: true, name: true, areaId: true } },
} as const;

export function createSchedulingRouter(prisma: PrismaClient) {
    const router = Router();

    // Staff availability is always written by the authenticated employee, never on someone else's behalf.
    router.post('/availability', async (req, res) => {
        const body = readBody(req.body);
        const date = body && businessDate(body.businessDate);
        if (!body || !onlyKeys(body, ['businessDate', 'shift', 'available']) || !date ||
            !validShift(body.shift) || typeof body.available !== 'boolean') {
            return void res.status(400).json({ error: 'Ngày, ca hoặc trạng thái đăng ký không hợp lệ.' });
        }
        try {
            const actor = await actorOf(prisma, res);
            if (!actor?.isActive || actor.role !== 'STAFF' || actor.workKind !== 'SALES' || !actor.areaId) {
                return void res.status(403).json({ error: 'Chỉ nhân viên bán hàng đã được gán khu vực mới có thể đăng ký lịch rảnh.' });
            }
            if (!body.available) {
                const scheduled = await prisma.shiftAssignment.findUnique({ where: { userId_businessDate_shift: {
                    userId: actor.id, businessDate: date, shift: body.shift as WorkShift } } });
                if (scheduled?.status === 'SCHEDULED') {
                    return void res.status(409).json({ error: 'Ca này đã được phân công. Hãy liên hệ quản lý để đổi hoặc hủy lịch.' });
                }
            }
            const data = await prisma.staffAvailability.upsert({
                where: { userId_businessDate_shift: { userId: actor.id, businessDate: date, shift: body.shift as WorkShift } },
                create: { userId: actor.id, businessDate: date, shift: body.shift as WorkShift, available: body.available },
                update: { available: body.available },
            });
            res.json({ data });
        } catch (error) { handleError(res, error); }
    });

    // GET /api/scheduling/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&areaId=UUID
    router.get('/availability', async (req, res) => {
        const span = dateSpan(req.query.from, req.query.to);
        if (!span || (req.query.areaId !== undefined && !isUuid(req.query.areaId))) {
            return void res.status(400).json({ error: 'Khoảng ngày hoặc khu vực không hợp lệ (tối đa 32 ngày).' });
        }
        try {
            const actor = await actorOf(prisma, res);
            if (!actor?.isActive) return void res.status(403).json({ error: 'Tài khoản không hoạt động.' });
            const areaId = actor.role === 'ADMIN' ? req.query.areaId as string | undefined : actor.areaId;
            if (actor.role !== 'STAFF' && !areaId) return void res.status(400).json({ error: 'Cần chọn khu vực.' });
            if (actor.role !== 'ADMIN' && req.query.areaId && req.query.areaId !== actor.areaId) {
                return void res.status(403).json({ error: 'Ngoài khu vực được quản lý.' });
            }
            const where: Prisma.StaffAvailabilityWhereInput = {
                businessDate: { gte: span.from, lte: span.to },
                user: actor.role === 'STAFF' ? { id: actor.id } : { areaId: areaId! },
            };
            const items = await prisma.staffAvailability.findMany({ where,
                select: { id: true, userId: true, businessDate: true, shift: true, available: true,
                    user: { select: { id: true, displayName: true } } },
                orderBy: [{ businessDate: 'asc' }, { shift: 'asc' }], take: 1000 });
            res.json({ items });
        } catch (error) { handleError(res, error); }
    });

    router.get('/assignments', async (req, res) => {
        const span = dateSpan(req.query.from, req.query.to);
        if (!span || (req.query.areaId !== undefined && !isUuid(req.query.areaId))) {
            return void res.status(400).json({ error: 'Khoảng ngày hoặc khu vực không hợp lệ.' });
        }
        try {
            const actor = await actorOf(prisma, res);
            if (!actor?.isActive) return void res.status(403).json({ error: 'Tài khoản không hoạt động.' });
            if (actor.role !== 'ADMIN' && req.query.areaId && req.query.areaId !== actor.areaId) {
                return void res.status(403).json({ error: 'Ngoài khu vực được quản lý.' });
            }
            const areaId = actor.role === 'ADMIN' ? req.query.areaId as string | undefined : actor.areaId;
            if (actor.role !== 'STAFF' && !areaId) return void res.status(400).json({ error: 'Cần chọn khu vực.' });
            const where: Prisma.ShiftAssignmentWhereInput = { businessDate: { gte: span.from, lte: span.to },
                ...(actor.role === 'STAFF' ? { userId: actor.id } : { branch: { areaId: areaId! } }) };
            const items = await prisma.shiftAssignment.findMany({ where, select: assignmentSelect,
                orderBy: [{ businessDate: 'asc' }, { shift: 'asc' }], take: 1000 });
            res.json({ items });
        } catch (error) { handleError(res, error); }
    });

    router.post('/assignments', async (req, res) => {
        const body = readBody(req.body);
        const date = body && businessDate(body.businessDate);
        if (!body || !onlyKeys(body, ['userId', 'branchId', 'businessDate', 'shift']) ||
            !isUuid(body.userId) || !isUuid(body.branchId) || !date || !validShift(body.shift)) {
            return void res.status(400).json({ error: 'Dữ liệu phân ca không hợp lệ.' });
        }
        try {
            const actor = await actorOf(prisma, res);
            if (!actor?.isActive || actor.role === 'STAFF') return void res.status(403).json({ error: 'Yêu cầu quyền quản lý.' });
            const data = await prisma.$transaction(async tx => {
                const [staff, branch, availability] = await Promise.all([
                    tx.user.findUnique({ where: { id: body.userId as string }, select: { id: true, role: true, workKind: true, isActive: true, areaId: true } }),
                    tx.branch.findUnique({ where: { id: body.branchId as string }, select: { id: true, isActive: true, areaId: true } }),
                    tx.staffAvailability.findUnique({ where: { userId_businessDate_shift: {
                        userId: body.userId as string, businessDate: date, shift: body.shift as WorkShift } } }),
                ]);
                if (!staff?.isActive || staff.role !== 'STAFF' || staff.workKind !== 'SALES' || !branch?.isActive ||
                    !staff.areaId || staff.areaId !== branch.areaId) {
                    return { issue: 'Nhân viên và quầy phải hoạt động và thuộc cùng một khu vực.' };
                }
                if (actor.role !== 'ADMIN' && actor.areaId !== branch.areaId) {
                    return { issue: 'Quản lý không có quyền phân công ngoài khu vực.' };
                }
                if (!availability?.available) return { issue: 'Nhân viên chưa xác nhận rảnh tại ca này.' };
                const existing = await tx.shiftAssignment.findUnique({ where: { userId_businessDate_shift: {
                    userId: staff.id, businessDate: date, shift: body.shift as WorkShift } } });
                if (existing) return { issue: 'Nhân viên đã có phân công trong ca. Dùng chức năng sửa lịch.' };
                const created = await tx.shiftAssignment.create({ data: {
                    userId: staff.id, branchId: branch.id, businessDate: date, shift: body.shift as WorkShift,
                    assignedById: actor.id,
                }, select: assignmentSelect });
                await tx.scheduleChangeLog.create({ data: { assignmentId: created.id, actorId: actor.id,
                    action: 'CREATED', nextBranchId: branch.id } });
                return { data: created };
            }, { isolationLevel: 'Serializable' });
            if ('issue' in data) return void res.status(409).json({ error: data.issue });
            res.status(201).json(data);
        } catch (error) { handleError(res, error); }
    });

    // Explicit expectedVersion prevents silent overwrites when managers edit the same assignment.
    router.patch('/assignments/:id', async (req, res) => {
        const body = readBody(req.body);
        if (!isUuid(req.params.id) || !body || !onlyKeys(body, ['branchId', 'status', 'expectedVersion']) ||
            !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1 ||
            (body.branchId !== undefined && !isUuid(body.branchId)) ||
            (body.status !== undefined && body.status !== 'SCHEDULED' && body.status !== 'CANCELLED') ||
            (body.branchId === undefined && body.status === undefined)) {
            return void res.status(400).json({ error: 'Dữ liệu sửa lịch không hợp lệ.' });
        }
        try {
            const actor = await actorOf(prisma, res);
            if (!actor?.isActive || actor.role === 'STAFF') return void res.status(403).json({ error: 'Yêu cầu quyền quản lý.' });
            const result = await prisma.$transaction(async tx => {
                const old = await tx.shiftAssignment.findUnique({ where: { id: req.params.id },
                    include: { branch: { select: { areaId: true } }, user: { select: { areaId: true, isActive: true } } } });
                if (!old) return { status: 404, error: 'Không tìm thấy phân ca.' };
                if (old.version !== body.expectedVersion) return { status: 409, error: 'Lịch đã thay đổi. Tải lại trước khi sửa.' };
                if (actor.role !== 'ADMIN' && actor.areaId !== old.branch.areaId) return { status: 403, error: 'Ngoài khu vực được quản lý.' };
                const targetId = (body.branchId as string | undefined) ?? old.branchId;
                const branch = await tx.branch.findUnique({ where: { id: targetId }, select: { areaId: true, isActive: true } });
                if (!branch?.isActive || !branch.areaId || branch.areaId !== old.user.areaId ||
                    (actor.role !== 'ADMIN' && branch.areaId !== actor.areaId)) {
                    return { status: 409, error: 'Quầy mới không thuộc khu vực của nhân viên/quản lý.' };
                }
                const status = (body.status as 'SCHEDULED' | 'CANCELLED' | undefined) ?? old.status;
                if (status === 'SCHEDULED') {
                    if (!old.user.isActive) return { status: 409, error: 'Nhân viên không còn hoạt động.' };
                    const availability = await tx.staffAvailability.findUnique({ where: { userId_businessDate_shift: {
                        userId: old.userId, businessDate: old.businessDate, shift: old.shift } } });
                    if (!availability?.available) return { status: 409, error: 'Nhân viên không đăng ký rảnh tại ca này.' };
                }
                const changed = await tx.shiftAssignment.updateMany({ where: { id: old.id, version: old.version },
                    data: { branchId: targetId, status, version: { increment: 1 }, assignedById: actor.id } });
                if (changed.count !== 1) return { status: 409, error: 'Lịch đã thay đổi. Tải lại trước khi sửa.' };
                await tx.scheduleChangeLog.create({ data: { assignmentId: old.id, actorId: actor.id,
                    action: status === 'CANCELLED' ? 'CANCELLED' : old.status === 'CANCELLED' ? 'REACTIVATED' : 'UPDATED',
                    previousBranchId: old.branchId, nextBranchId: targetId } });
                const data = await tx.shiftAssignment.findUniqueOrThrow({ where: { id: old.id }, select: assignmentSelect });
                return { status: 200, data };
            }, { isolationLevel: 'Serializable' });
            if ('error' in result) return void res.status(result.status).json({ error: result.error });
            res.json({ data: result.data });
        } catch (error) { handleError(res, error); }
    });

    return router;
}
