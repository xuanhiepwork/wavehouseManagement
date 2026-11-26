import type { Prisma, PrismaClient, WorkShift } from '../generated/prisma/client';

// G2 single source of truth for branch/shift access. Treat branchId as legacy,
// never as an additional grant when a user has an assigned area.
export type OperationalActor = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    branchId: string | null;
    areaId?: string | null;
    workKind?: string;
};

type Db = PrismaClient | Prisma.TransactionClient;
const shifts: WorkShift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
export function isWorkShift(value: unknown): value is WorkShift {
    return typeof value === 'string' && shifts.includes(value as WorkShift);
}
export function vietnamBusinessDay(): Date {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (key: string) => parts.find(item => item.type === key)?.value ?? '';
    return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}
export function branchScope(actor: OperationalActor): Prisma.BranchWhereInput {
    if (actor.role === 'ADMIN') return {};
    if (actor.role === 'BRANCH_MANAGER') return actor.areaId
        ? { areaId: actor.areaId } : { id: { in: actor.branchId ? [actor.branchId] : [] } };
    return { id: { in: [] } }; // Staff access requires an actual scheduled shift.
}

// The server selects permitted branches from persisted assignments, never the UI.
// For STAFF this returns only branches assigned on this date (and shift, if supplied).
export async function operationalBranchIds(db: Db, actor: OperationalActor,
    date: Date = vietnamBusinessDay(), shift?: WorkShift): Promise<string[]> {
    if (actor.role === 'ADMIN') {
        const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
        return branches.map(row => row.id);
    }
    if (actor.role === 'BRANCH_MANAGER') {
        const branches = await db.branch.findMany({ where: { ...branchScope(actor), isActive: true }, select: { id: true } });
        return branches.map(row => row.id);
    }
    if (actor.workKind === 'KITCHEN_DELIVERY') return [];
    if (actor.areaId && actor.workKind === 'SALES') {
        const assignments = await db.shiftAssignment.findMany({ where: {
            userId: actor.id, businessDate: date, status: 'SCHEDULED',
            ...(shift ? { shift } : {}),
            branch: { isActive: true, areaId: actor.areaId },
        }, select: { branchId: true } });
        return [...new Set(assignments.map(item => item.branchId))];
    }
    // Compatibility for legacy staff accounts not migrated to an Area.
    if (!actor.areaId && actor.branchId && (!actor.workKind || actor.workKind === 'SALES')) {
        const old = await db.branch.findFirst({ where: { id: actor.branchId, isActive: true }, select: { id: true } });
        return old ? [old.id] : [];
    }
    return [];
}

export async function canOperateBranch(db: Db, actor: OperationalActor, branchId: string,
    date: Date = vietnamBusinessDay(), shift?: WorkShift): Promise<boolean> {
    // ADMIN may operate inactive branches only in read flows; this method is for actions.
    const ids = await operationalBranchIds(db, actor, date, shift);
    return ids.includes(branchId);
}

export function managerAreaWhere(actor: OperationalActor): Prisma.BranchWhereInput {
    return branchScope(actor);
}
