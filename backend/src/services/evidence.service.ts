import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { operationalBranchIds, type OperationalActor } from './operational-access.service';
import { UUID_RE, prismaErrorCode } from '../utils/admin-api';

/** Photos are small and private; PostgreSQL BYTEA is the initial storage backend. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TARGET = 5;
export type EvidenceTarget = 'trip' | 'stop' | 'count';
export type EvidenceKind = 'delivery' | 'receiving' | 'inventory' | 'damage';
type Db = PrismaClient | Prisma.TransactionClient;
export type EvidenceActor = OperationalActor;

export class EvidenceError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
}
const targetKinds: Record<EvidenceTarget, readonly EvidenceKind[]> = {
    trip: ['delivery'],
    stop: ['receiving', 'damage'],
    count: ['inventory', 'damage'],
};
const modelTarget = { trip: 'TRIP', stop: 'STOP', count: 'COUNT' } as const;
const modelKind = { delivery: 'DELIVERY', receiving: 'RECEIVING', inventory: 'INVENTORY', damage: 'DAMAGE' } as const;
const mimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;

type UploadInput = { kind: EvidenceKind; note: string | null; mimeType: typeof mimeTypes[number]; photoBytes: Buffer; sha256: string };
const metadataSelect = {
    id: true, targetType: true, targetId: true, kind: true, note: true, mimeType: true,
    byteSize: true, sha256: true, createdById: true, createdAt: true,
} as const;

export function parseTarget(type: unknown, targetId: unknown): { type: EvidenceTarget; targetId: string } {
    if ((type !== 'trip' && type !== 'stop' && type !== 'count') ||
        typeof targetId !== 'string' || !UUID_RE.test(targetId)) {
        throw new EvidenceError('Doi tuong minh chung khong hop le.', 400);
    }
    return { type, targetId: targetId.toLowerCase() };
}
function detectMime(bytes: Buffer): typeof mimeTypes[number] | null {
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'image/jpeg';
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.subarray(bytes.length - 12, bytes.length - 8).toString('ascii') === 'IEND') return 'image/png';
    if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}
export function parseUpload(input: unknown, targetType: EvidenceTarget): UploadInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EvidenceError('Du lieu anh khong hop le.', 400);
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(key => !['kind', 'note', 'mimeType', 'dataBase64'].includes(key))) {
        throw new EvidenceError('Truong khong duoc ho tro.', 400);
    }
    const kind = body.kind;
    const mime = body.mimeType;
    if (typeof kind !== 'string' || !targetKinds[targetType].includes(kind as EvidenceKind) ||
        typeof mime !== 'string' || !mimeTypes.includes(mime as typeof mimeTypes[number])) {
        throw new EvidenceError('Loai anh khong phu hop voi nghiep vu.', 400);
    }
    const note = body.note == null ? null : body.note;
    if (note !== null && (typeof note !== 'string' || note.trim().length > 500)) {
        throw new EvidenceError('Ghi chu toi da 500 ky tu.', 400);
    }
    // Bound base64 length before allocating a binary buffer.
    const data = body.dataBase64;
    if (typeof data !== 'string' || data.length > 2_800_000 ||
        data.length < 16 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        throw new EvidenceError('Anh phai la base64 hop le va khong qua 2 MB.', 400);
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== data) {
        throw new EvidenceError('Anh phai la base64 hop le va khong qua 2 MB.', 400);
    }
    const detected = detectMime(bytes);
    if (detected !== mime) throw new EvidenceError('Noi dung anh khong khop dinh dang khai bao.', 415);
    return {
        kind: kind as EvidenceKind,
        note: typeof note === 'string' ? (note.trim() || null) : null,
        mimeType: mime as typeof mimeTypes[number],
        photoBytes: bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}

// Re-check permissions inside the database transaction, including record state.
// No permission is inferred solely from a client-provided target ID.
async function authorize(db: Db, actor: EvidenceActor, type: EvidenceTarget, id: string, write: boolean) {
    if (type === 'trip') {
        const trip = await db.deliveryTrip.findUnique({ where: { id },
            select: { id: true, status: true, warehouseId: true, courierId: true } });
        if (!trip) throw new EvidenceError('Khong tim thay chuyen giao.', 404);
        if (actor.role !== 'ADMIN') {
            if (actor.role !== 'STAFF' || actor.workKind !== 'KITCHEN_DELIVERY' || trip.courierId !== actor.id ||
                !(await db.warehouseWorkerAssignment.findFirst({ where: {
                    userId: actor.id, warehouseId: trip.warehouseId, isActive: true, warehouse: { isActive: true },
                }, select: { id: true } }))) throw new EvidenceError('Khong co quyen truy cap chuyen giao.', 403);
        }
        if (write && trip.status !== 'IN_TRANSIT') throw new EvidenceError('Chi luu anh cho chuyen dang giao.', 409);
        return;
    }
    if (type === 'stop') {
        const stop = await db.deliveryStop.findUnique({ where: { id },
            select: { id: true, status: true, branchId: true,
                trip: { select: { businessDate: true, warehouseId: true, courierId: true } } } });
        if (!stop) throw new EvidenceError('Khong tim thay diem giao.', 404);
        if (actor.role !== 'ADMIN') {
            if (actor.workKind === 'KITCHEN_DELIVERY' && actor.role === 'STAFF') {
                if (stop.trip.courierId !== actor.id ||
                    !(await db.warehouseWorkerAssignment.findFirst({ where: {
                        userId: actor.id, warehouseId: stop.trip.warehouseId, isActive: true, warehouse: { isActive: true },
                    }, select: { id: true } }))) throw new EvidenceError('Khong co quyen tai diem giao.', 403);
            } else {
                const branches = await operationalBranchIds(db, actor, stop.trip.businessDate, 'MORNING');
                if (!branches.includes(stop.branchId)) throw new EvidenceError('Khong co quyen tai diem giao.', 403);
            }
        }
        if (write && stop.status !== 'DISPATCHED') throw new EvidenceError('Chi luu anh truoc khi xac nhan nhan hang.', 409);
        return;
    }
    const count = await db.shiftStockCount.findUnique({ where: { id },
        select: { id: true, status: true, branchId: true, businessDate: true, shift: true, createdById: true,
            branch: { select: { areaId: true, isActive: true } } } });
    if (!count) throw new EvidenceError('Khong tim thay phieu kiem ke.', 404);
    if (actor.role === 'BRANCH_MANAGER') {
        const allowed = actor.areaId ? count.branch.areaId === actor.areaId
            : !!actor.branchId && count.branchId === actor.branchId;
        if (!allowed) throw new EvidenceError('Khong thuoc khu vuc quan ly.', 403);
    } else if (actor.role === 'STAFF') {
        if (actor.workKind === 'KITCHEN_DELIVERY' || count.createdById !== actor.id ||
            !(await operationalBranchIds(db, actor, count.businessDate, count.shift)).includes(count.branchId)) {
            throw new EvidenceError('Khong co quyen truy cap phieu kiem ke.', 403);
        }
    }
    if (write && count.status !== 'DRAFT' && count.status !== 'RETURNED') {
        throw new EvidenceError('Phieu da nop / duyet, khong the bo sung anh.', 409);
    }
}

export async function listEvidence(db: PrismaClient, actor: EvidenceActor, type: EvidenceTarget, id: string) {
    await authorize(db, actor, type, id, false);
    return db.evidenceAttachment.findMany({ where: { targetType: modelTarget[type], targetId: id },
        select: metadataSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_ATTACHMENTS_PER_TARGET });
}

export async function createEvidence(db: PrismaClient, actor: EvidenceActor, type: EvidenceTarget, id: string, input: UploadInput) {
    return db.$transaction(async tx => {
        // Serialize writes per business document so MAX_ATTACHMENTS_PER_TARGET stays strict.
        const lockKey = `wavehouse:evidence:${type}:${id}`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        // Lock the parent record as well: a concurrent confirm/approve/complete update
        // must not overtake the status check and allow post-finalization evidence.
        if (type === 'trip') {
            await tx.$queryRaw`SELECT 1 AS locked FROM delivery_trips WHERE id = ${id}::uuid FOR SHARE`;
        } else if (type === 'stop') {
            await tx.$queryRaw`SELECT 1 AS locked FROM delivery_stops WHERE id = ${id}::uuid FOR SHARE`;
        } else {
            await tx.$queryRaw`SELECT 1 AS locked FROM shift_stock_counts WHERE id = ${id}::uuid FOR SHARE`;
        }
        await authorize(tx, actor, type, id, true);
        const targetType = modelTarget[type];
        const duplicate = await tx.evidenceAttachment.findFirst({
            where: { targetType, targetId: id, sha256: input.sha256 }, select: metadataSelect,
        });
        if (duplicate) return { data: duplicate, created: false };
        const count = await tx.evidenceAttachment.count({ where: { targetType, targetId: id } });
        if (count >= MAX_ATTACHMENTS_PER_TARGET) throw new EvidenceError('Da du 5 anh cho phieu nay.', 409);
        const data = await tx.evidenceAttachment.create({ data: {
            targetType, targetId: id, kind: modelKind[input.kind], note: input.note,
            mimeType: input.mimeType, byteSize: input.photoBytes.length,
            sha256: input.sha256, photoBytes: input.photoBytes, createdById: actor.id,
        }, select: metadataSelect });
        return { data, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 20000 });
}

export async function getEvidenceImage(db: PrismaClient, actor: EvidenceActor,
    type: EvidenceTarget, targetId: string, imageId: string) {
    if (!UUID_RE.test(imageId)) throw new EvidenceError('ID anh khong hop le.', 400);
    await authorize(db, actor, type, targetId, false);
    const row = await db.evidenceAttachment.findFirst({ where: {
        id: imageId.toLowerCase(), targetType: modelTarget[type], targetId,
    }, select: { mimeType: true, photoBytes: true } });
    if (!row) throw new EvidenceError('Khong tim thay anh.', 404);
    return { mimeType: row.mimeType, bytes: Buffer.from(row.photoBytes) };
}
export function evidenceFailure(error: unknown): { status: number; message: string } {
    if (error instanceof EvidenceError) return { status: error.status, message: error.message };
    if (prismaErrorCode(error) === 'P2002' || prismaErrorCode(error) === 'P2034') {
        return { status: 409, message: 'Du lieu thay doi, vui long tai lai.' };
    }
    return { status: 503, message: 'He thong minh chung tam thoi khong san sang.' };
}
