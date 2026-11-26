/** G9: read-only cross-location operational stock audit.
 * Balances are *current*; delivery/recovery/write-off activity is *period based*.
 * They are different measures and must never be summed into a misleading total.
 */
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { DistributionActor } from './distribution.service';

export class StockAuditError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
}
const ZERO = new Prisma.Decimal(0);
const MAX_STOPS = 3000;
const MAX_DOCS = 3000;
type Db = Prisma.TransactionClient;
type Qty = InstanceType<typeof Prisma.Decimal>;
type AuditRow = {
    ingredientId: string; code: string; name: string; unit: string;
    branchOnHand: Qty; warehouseOnHand: Qty; inTransit: Qty;
    dispatched: Qty; received: Qty; damaged: Qty; missing: Qty;
    recovered: Qty; stillMissing: Qty; postedWriteOff: Qty;
};
function date(value: unknown, label: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new StockAuditError(`${label} phải theo YYYY-MM-DD.`, 400);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
        throw new StockAuditError(`${label} không hợp lệ.`, 400);
    return parsed;
}
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const localDay = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (key: string) => parts.find(x => x.type === key)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
};
export function auditPeriod(inputFrom: unknown, inputTo: unknown) {
    const toString = inputTo === undefined ? localDay() : inputTo;
    const to = date(toString, 'Đến ngày');
    const defaultFrom = new Date(to.valueOf() - 6 * 86400000);
    const from = date(inputFrom === undefined ? isoDay(defaultFrom) : inputFrom, 'Từ ngày');
    const span = Math.round((to.valueOf() - from.valueOf()) / 86400000);
    if (span < 0 || span > 30) throw new StockAuditError('Chỉ xem khoảng thời gian từ 1 đến 31 ngày.', 400);
    const end = new Date(to.valueOf() + 86400000);
    // Write-off reviewedAt is timestamptz; report it in Vietnam business time.
    const fromInstant = new Date(`${isoDay(from)}T00:00:00+07:00`);
    const endInstant = new Date(`${isoDay(end)}T00:00:00+07:00`);
    return { from, to, fromInstant, endInstant, fromLabel: isoDay(from), toLabel: isoDay(to) };
}
async function actorScope(tx: Db, actor: DistributionActor) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: {
        id: true, role: true, isActive: true, areaId: true, branchId: true,
        area: { select: { isActive: true } },
    } });
    if (!user?.isActive || !['ADMIN', 'BRANCH_MANAGER'].includes(user.role))
        throw new StockAuditError('Chỉ ADMIN và quản lý khu vực được xem G9.', 403);
    if (user.role === 'BRANCH_MANAGER' && user.areaId && !user.area?.isActive)
        throw new StockAuditError('Khu vực không còn hoạt động.', 403);
    if (user.role === 'BRANCH_MANAGER' && !user.areaId && !user.branchId)
        throw new StockAuditError('Tài khoản chưa được phân công khu vực.', 403);
    const branches = await tx.branch.findMany({
        where: user.role === 'ADMIN' ? {} : user.areaId ? { areaId: user.areaId } : { id: user.branchId! },
        select: { id: true, code: true, name: true, isActive: true, areaId: true }, orderBy: { code: 'asc' },
    });
    const warehouses = user.role === 'ADMIN'
        ? await tx.warehouse.findMany({ select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: 'asc' } })
        : [];
    return { isAdmin: user.role === 'ADMIN', areaId: user.areaId, branches, warehouses,
        branchIds: branches.map(x => x.id), warehouseIds: warehouses.map(x => x.id) };
}
function decimal(value: Prisma.Decimal | null | undefined): Qty { return value ?? ZERO; }
function fixed(value: Qty) { return value.toFixed(6); }
function add(row: AuditRow, key: keyof AuditRow, value: Qty) {
    // Dynamic keys here are used only for declared quantity columns.
    (row as unknown as Record<string, Qty>)[key] = (row[key] as Qty).plus(value);
}

export async function stockAuditSnapshot(db: PrismaClient, actor: DistributionActor, fromValue: unknown, toValue: unknown) {
    const period = auditPeriod(fromValue, toValue);
    return db.$transaction(async tx => {
        const scope = await actorScope(tx, actor);
        const rows = new Map<string, AuditRow>();
        const rowFor = (ingredientId: string, ingredient: { code: string; name: string; unit: string }) => {
            let found = rows.get(ingredientId);
            if (!found) {
                found = { ingredientId, code: ingredient.code, name: ingredient.name, unit: ingredient.unit,
                    branchOnHand: ZERO, warehouseOnHand: ZERO, inTransit: ZERO,
                    dispatched: ZERO, received: ZERO, damaged: ZERO, missing: ZERO,
                    recovered: ZERO, stillMissing: ZERO, postedWriteOff: ZERO };
                rows.set(ingredientId, found);
            }
            return found;
        };
        const ingredientSelect = { code: true, name: true, unit: true } as const;
        const [branchBalances, warehouseBalances] = await Promise.all([
            scope.branchIds.length ? tx.inventoryBalance.findMany({ where: { branchId: { in: scope.branchIds } },
                select: { branchId: true, ingredientId: true, quantity: true, ingredient: { select: ingredientSelect } } }) : [],
            scope.warehouseIds.length ? tx.warehouseInventoryBalance.findMany({ where: { warehouseId: { in: scope.warehouseIds } },
                select: { warehouseId: true, ingredientId: true, quantity: true, ingredient: { select: ingredientSelect } } }) : [],
        ]);
        for (const item of branchBalances) add(rowFor(item.ingredientId, item.ingredient), 'branchOnHand', item.quantity);
        for (const item of warehouseBalances) add(rowFor(item.ingredientId, item.ingredient), 'warehouseOnHand', item.quantity);

        // Pending stops are *global*, regardless of the date filter. Otherwise old stalled
        // deliveries silently disappear from the transit inventory.
        const scopeStop = { branchId: { in: scope.branchIds } };
        const pendingCount = scope.branchIds.length ? await tx.deliveryStop.count({ where: {
            ...scopeStop, status: 'DISPATCHED', trip: { status: 'IN_TRANSIT' },
        } }) : 0;
        if (pendingCount > MAX_STOPS) throw new StockAuditError('Quá nhiều điểm giao chưa nhận; hãy đối soát dữ liệu tồn đọng trước.', 409);
        const pending = pendingCount ? await tx.deliveryStop.findMany({ where: {
            ...scopeStop, status: 'DISPATCHED', trip: { status: 'IN_TRANSIT' },
        }, select: {
            id: true, branchId: true, trip: { select: { code: true, businessDate: true } },
            branch: { select: { code: true } },
            items: { select: { ingredientId: true, plannedQuantity: true, ingredient: { select: ingredientSelect } } },
        }, orderBy: [{ tripId: 'asc' }, { stopOrder: 'asc' }] }) : [];
        for (const stop of pending) for (const item of stop.items)
            add(rowFor(item.ingredientId, item.ingredient), 'inTransit', item.plannedQuantity);

        // Business-date window: confirmed stops only. Pending goods are reported above
        // rather than counted a second time among received goods.
        const receivedWhere = { ...scopeStop, status: 'RECEIVED',
            trip: { businessDate: { gte: period.from, lte: period.to }, status: { in: ['IN_TRANSIT', 'COMPLETE'] } } };
        const receivedCount = scope.branchIds.length ? await tx.deliveryStop.count({ where: receivedWhere }) : 0;
        if (receivedCount > MAX_STOPS) throw new StockAuditError('G9 chỉ hỗ trợ tối đa 3000 điểm giao đã nhận trong một kỳ. Thu hẹp ngày xem.', 409);
        const receivedStops = receivedCount ? await tx.deliveryStop.findMany({ where: receivedWhere, select: {
            id: true, branchId: true, trip: { select: { code: true, businessDate: true } },
            branch: { select: { code: true } },
            items: { select: { ingredientId: true, plannedQuantity: true, receivedQuantity: true,
                damagedQuantity: true, ingredient: { select: ingredientSelect } } },
            discrepancy: { select: { id: true, status: true, recoveryAdjustments: {
                where: { status: 'POSTED' }, select: { lines: { select: { ingredientId: true, quantity: true } } },
            } } },
        }, orderBy: [{ tripId: 'asc' }, { stopOrder: 'asc' }] }) : [];
        let anomalyCount = 0;
        const anomalies: Array<{kind: string; branchCode: string; tripCode: string; ingredientCode: string; message: string}> = [];
        const warn = (item: {kind: string; branchCode: string; tripCode: string; ingredientCode: string; message: string}) => {
            anomalyCount++; if (anomalies.length < 100) anomalies.push(item);
        };
        for (const stop of receivedStops) {
            for (const item of stop.items) {
                const planned = item.plannedQuantity;
                const actual = decimal(item.receivedQuantity);
                const broken = decimal(item.damagedQuantity);
                const missing = Prisma.Decimal.max(ZERO, planned.minus(actual).minus(broken));
                const found = (stop.discrepancy?.recoveryAdjustments ?? []).reduce((total, doc) =>
                    doc.lines.reduce((sum, line) => line.ingredientId === item.ingredientId ? sum.plus(line.quantity) : sum, total), ZERO);
                const r = rowFor(item.ingredientId, item.ingredient);
                add(r, 'dispatched', planned);
                add(r, 'received', actual);
                add(r, 'damaged', broken);
                add(r, 'missing', missing);
                add(r, 'recovered', found);
                add(r, 'stillMissing', Prisma.Decimal.max(ZERO, missing.minus(found)));
                if (actual.plus(broken).gt(planned) || found.gt(missing)) {
                    warn({ kind: 'DELIVERY_QUANTITY', branchCode: stop.branch.code,
                        tripCode: stop.trip.code, ingredientCode: item.ingredient.code,
                        message: 'Số nhận/hỏng/thu hồi vượt lượng được giao hoặc còn thiếu.' });
                }
            }
        }

        const placeFilter = [
            ...(scope.branchIds.length ? [{ branchId: { in: scope.branchIds } }] : []),
            ...(scope.warehouseIds.length ? [{ warehouseId: { in: scope.warehouseIds } }] : []),
        ];
        const writeOffWindow = { status: 'POSTED', reviewedAt: { gte: period.fromInstant, lt: period.endInstant },
            OR: placeFilter };
        const writeOffCount = placeFilter.length ? await tx.stockWriteOff.count({ where: writeOffWindow }) : 0;
        if (writeOffCount > MAX_DOCS) throw new StockAuditError('Quá nhiều phiếu ghi giảm trong kỳ; thu hẹp khoảng ngày.', 409);
        const writeOffs = writeOffCount ? await tx.stockWriteOff.findMany({ where: writeOffWindow,
            select: { id: true, lines: { select: { ingredientId: true, quantity: true, ingredient: { select: ingredientSelect } } } },
        }) : [];
        for (const doc of writeOffs) for (const item of doc.lines)
            add(rowFor(item.ingredientId, item.ingredient), 'postedWriteOff', item.quantity);

        const [openDiscrepancies, pendingWriteOffs, pendingRestockPlans] = await Promise.all([
            scope.branchIds.length ? tx.deliveryDiscrepancy.count({ where: {
                status: 'OPEN', stop: { branchId: { in: scope.branchIds } },
            } }) : 0,
            placeFilter.length ? tx.stockWriteOff.count({ where: { status: 'SUBMITTED', OR: placeFilter } }) : 0,
            scope.isAdmin ? tx.restockPlan.count({ where: { status: 'SUBMITTED' } })
                : scope.areaId ? tx.restockPlan.count({ where: { status: 'SUBMITTED', areaId: scope.areaId } }) : 0,
        ]);

        // Latest ledger quantity_after compared with current balance. No historical
        // stock estimate is inferred from a range-filtered movement sum.
        const ledgerIssues: Array<{locationType: 'BRANCH'|'WAREHOUSE'; locationCode: string;
            ingredientCode: string; current: string; ledger: string|null; issue: string}> = [];
        let moreLedgerIssues = false;
        async function inspectLedger(kind: 'BRANCH'|'WAREHOUSE') {
            const ids = kind === 'BRANCH' ? scope.branchIds : scope.warehouseIds;
            if (!ids.length) return;
            const idSet = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
            // LATERAL index lookup returns the newest posted ledger row for each balance.
            const sql = kind === 'BRANCH'
                ? Prisma.sql`SELECT b.branch_id AS "locationId", i.code AS "ingredientCode",
                    b.quantity AS "current", m.quantity_after AS "ledger"
                    FROM inventory_balances b JOIN ingredients i ON i.id=b.ingredient_id
                    LEFT JOIN LATERAL (
                      SELECT quantity_after FROM inventory_movements m
                      WHERE m.branch_id=b.branch_id AND m.ingredient_id=b.ingredient_id
                      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
                    ) m ON TRUE
                    WHERE b.branch_id IN (${idSet}) AND m.quantity_after IS DISTINCT FROM b.quantity
                    LIMIT 201`
                : Prisma.sql`SELECT b.warehouse_id AS "locationId", i.code AS "ingredientCode",
                    b.quantity AS "current", m.quantity_after AS "ledger"
                    FROM warehouse_inventory_balances b JOIN ingredients i ON i.id=b.ingredient_id
                    LEFT JOIN LATERAL (
                      SELECT quantity_after FROM warehouse_inventory_movements m
                      WHERE m.warehouse_id=b.warehouse_id AND m.ingredient_id=b.ingredient_id
                      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
                    ) m ON TRUE
                    WHERE b.warehouse_id IN (${idSet}) AND m.quantity_after IS DISTINCT FROM b.quantity
                    LIMIT 201`;
            const list = await tx.$queryRaw<Array<{locationId:string;ingredientCode:string;current:Qty;ledger:Qty|null}>>(sql);
            if (list.length > 200) moreLedgerIssues = true;
            const lookup = new Map((kind === 'BRANCH' ? scope.branches : scope.warehouses).map(x => [x.id, x.code]));
            for (const item of list.slice(0, 200)) ledgerIssues.push({ locationType: kind,
                locationCode: lookup.get(item.locationId) ?? item.locationId,
                ingredientCode: item.ingredientCode, current: fixed(item.current),
                ledger: item.ledger === null ? null : fixed(item.ledger),
                issue: item.ledger === null ? 'NO_MOVEMENT' : 'BALANCE_MISMATCH',
            });
        }
        await inspectLedger('BRANCH');
        await inspectLedger('WAREHOUSE');

        return {
            period: { from: period.fromLabel, to: period.toLabel },
            asOf: new Date().toISOString(),
            scope: { role: scope.isAdmin ? 'ADMIN' : 'BRANCH_MANAGER',
                branches: scope.branches, warehouses: scope.warehouses },
            notes: [
                'Số dư kho/quầy là số dư hiện tại; giao nhận và ghi giảm là số phát sinh trong kỳ. Không cộng hai loại chỉ tiêu.',
                'Hàng đang vận chuyển gồm mọi điểm giao chưa xác nhận, kể cả các ngày trước kỳ lọc; chỉ tính một lần.',
                'Hàng hỏng và thiếu chưa nhận không được cộng vào tồn quầy. Hàng thu hồi POSTED ở G7 đã nằm trong số dư hiện tại.',
                'Chỉ tiêu theo SKU và đơn vị gốc; không cộng gram, ml và cái thành một tổng.',
            ],
            counts: { pendingStops: pending.length, receivedStops: receivedStops.length,
                openDiscrepancies, pendingWriteOffs, pendingRestockPlans,
                postedWriteOffs: writeOffCount, ledgerIssueCountShown: ledgerIssues.length,
                ledgerIssuesMore: moreLedgerIssues, deliveryAnomalyCount: anomalyCount },
            rows: [...rows.values()].sort((a,b) => a.code.localeCompare(b.code)).map(r => ({
                ingredientId: r.ingredientId, code: r.code, name: r.name, unit: r.unit,
                branchOnHand: fixed(r.branchOnHand), warehouseOnHand: scope.isAdmin ? fixed(r.warehouseOnHand) : null,
                inTransit: fixed(r.inTransit), dispatched: fixed(r.dispatched), received: fixed(r.received),
                damaged: fixed(r.damaged), missing: fixed(r.missing), recovered: fixed(r.recovered),
                stillMissing: fixed(r.stillMissing), postedWriteOff: fixed(r.postedWriteOff),
            })),
            pendingStops: pending.map(s => ({ id: s.id, tripCode: s.trip.code,
                businessDate: isoDay(s.trip.businessDate), branchCode: s.branch.code,
                itemCount: s.items.length })),
            deliveryAnomalies: anomalies,
            ledgerIssues, 
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 45000 });
}
