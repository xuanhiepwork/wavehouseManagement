
import { Prisma, type PrismaClient } from '../generated/prisma/client';

export type ForecastShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
type DayType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

export type ForecastRequest = {
    sourceBranchId: string;
    destinationBranchIds: string[];
    businessDate: Date;
    shift: ForecastShift;
};

export class ForecastError extends Error {
    constructor(
        message: string,
        public readonly status = 400
    ) {
        super(message);
    }
}

const ZERO = new Prisma.Decimal(0);
const SHIFTS: ForecastShift[] = [
    'MORNING',
    'AFTERNOON',
    'EVENING',
];

function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function shiftIndex(date: Date, shift: ForecastShift): number {
    return Math.floor(date.getTime() / 86400000) * 3
        + SHIFTS.indexOf(shift);
}

function balanceKey(branchId: string, ingredientId: string) {
    return `${branchId}:${ingredientId}`;
}

function nonNegative(value: Prisma.Decimal): Prisma.Decimal {
    return value.gt(0) ? value : ZERO;
}

type Sample = {
    shift: ForecastShift;
    dayType: DayType;
    amount: Prisma.Decimal;
};

type Suggestion = {
    branchId: string;
    branchCode: string;
    branchName: string;
    ingredientId: string;
    ingredientCode: string;
    ingredientName: string;
    unit: 'g' | 'ml' | 'piece';
    onHand: Prisma.Decimal;
    forecast: Prisma.Decimal;
    needed: Prisma.Decimal;
    allocated: Prisma.Decimal;
    samples: number;
    method: string;
};

export async function buildRestockRecommendations(
    prisma: PrismaClient,
    input: ForecastRequest
) {
    const {
        sourceBranchId,
        destinationBranchIds,
        businessDate,
        shift,
    } = input;

    const targetKey = dateKey(businessDate);
    const targetIndex = shiftIndex(businessDate, shift);

    const historyStart = new Date(businessDate);
    historyStart.setUTCDate(historyStart.getUTCDate() - 90);

    const allBranchIds = [
        sourceBranchId,
        ...destinationBranchIds,
    ];

    const [branches, ingredients, balances, counts, overrides] =
        await Promise.all([
            prisma.branch.findMany({
                where: {
                    id: { in: allBranchIds },
                    isActive: true,
                },
                select: {
                    id: true,
                    code: true,
                    name: true,
                },
            }),
            prisma.ingredient.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    code: true,
                    name: true,
                    unit: true,
                    minStock: true,
                },
                orderBy: { code: 'asc' },
            }),
            prisma.inventoryBalance.findMany({
                where: {
                    branchId: { in: allBranchIds },
                },
                select: {
                    branchId: true,
                    ingredientId: true,
                    quantity: true,
                },
            }),
            prisma.shiftStockCount.findMany({
                where: {
                    branchId: { in: destinationBranchIds },
                    status: 'APPROVED',
                    businessDate: {
                        gte: historyStart,
                        lte: businessDate,
                    },
                },
                select: {
                    branchId: true,
                    businessDate: true,
                    shift: true,
                    items: {
                        select: {
                            ingredientId: true,
                            variance: true,
                        },
                    },
                },
                orderBy: { businessDate: 'asc' },
            }),
            prisma.demandCalendarOverride.findMany({
                where: {
                    businessDate: {
                        gte: historyStart,
                        lte: businessDate,
                    },
                },
                select: {
                    businessDate: true,
                    dayType: true,
                },
            }),
        ]);

    if (branches.length !== allBranchIds.length) {
        throw new ForecastError(
            'Source or destination branch unavailable',
            409
        );
    }

    if (ingredients.length > 500) {
        throw new ForecastError(
            'Too many ingredients for this planning request'
        );
    }

    const branchMap = new Map(
        branches.map(branch => [branch.id, branch])
    );

    const balanceMap = new Map(
        balances.map(balance => [
            balanceKey(balance.branchId, balance.ingredientId),
            balance.quantity,
        ])
    );

    const overrideMap = new Map(
        overrides.map(item => [
            dateKey(item.businessDate),
            item.dayType as DayType,
        ])
    );

    function getDayType(date: Date): DayType {
        const override = overrideMap.get(dateKey(date));

        if (override) return override;

        const day = date.getUTCDay();
        return day === 0 || day === 6
            ? 'WEEKEND'
            : 'WEEKDAY';
    }

    const targetDayType = getDayType(businessDate);

    // A complete single-shift observation requires an
    // APPROVED count in the immediately preceding shift.
    const keys = new Set(
        counts.map(count =>
            `${count.branchId}:${shiftIndex(
                count.businessDate,
                count.shift
            )}`
        )
    );

    const observations = new Map<string, Sample[]>();

    const orderedCounts = [...counts].sort(
        (a, b) =>
            shiftIndex(a.businessDate, a.shift)
            - shiftIndex(b.businessDate, b.shift)
    );

    for (const count of orderedCounts) {
        const currentIndex = shiftIndex(
            count.businessDate,
            count.shift
        );

        if (
            currentIndex >= targetIndex ||
            !keys.has(`${count.branchId}:${currentIndex - 1}`)
        ) {
            continue;
        }

        const dayType = getDayType(count.businessDate);

        for (const item of count.items) {
            if (item.variance === null) continue;

            const used = item.variance.lt(0)
                ? item.variance.negated()
                : ZERO;

            const key = balanceKey(
                count.branchId,
                item.ingredientId
            );

            const list = observations.get(key) ?? [];

            list.push({
                shift: count.shift,
                dayType,
                amount: used,
            });

            observations.set(key, list);
        }
    }

    const suggestions: Suggestion[] = [];

    for (const branchId of destinationBranchIds) {
        const branch = branchMap.get(branchId)!;

        for (const ingredient of ingredients) {
            const history =
                observations.get(balanceKey(branchId, ingredient.id))
                ?? [];

            const sameShift = history.filter(
                sample => sample.shift === shift
            );

            const matched = sameShift.filter(
                sample => sample.dayType === targetDayType
            );

            const enoughMatched = matched.length >= 3;
            const chosen = enoughMatched ? matched : sameShift;
            const recent = chosen.slice(-8);

            const total = recent.reduce(
                (sum, sample) => sum.plus(sample.amount),
                ZERO
            );

            let forecast = recent.length > 0
                ? total.div(recent.length)
                : ZERO;

            const method = enoughMatched
                ? 'MATCHED_DAY_AND_SHIFT'
                : recent.length > 0
                    ? 'SAME_SHIFT_HEURISTIC'
                    : 'MIN_STOCK_ONLY';

            // Explicit heuristic when exact-day history is scarce.
            if (!enoughMatched) {
                const factor =
                    targetDayType === 'HOLIDAY' ? '1.35' :
                        targetDayType === 'WEEKEND' ? '1.15' :
                            '1.00';

                forecast = forecast.mul(factor);
            }

            const onHand = balanceMap.get(
                balanceKey(branchId, ingredient.id)
            ) ?? ZERO;

            // Cover the expected shift demand, a 20% buffer,
            // and the ingredient's configured minimum stock.
            const desired = forecast
                .mul('1.20')
                .plus(ingredient.minStock);

            const places = ingredient.unit === 'piece' ? 0 : 6;

            const needed = nonNegative(
                desired.minus(onHand)
            ).toDecimalPlaces(
                places,
                Prisma.Decimal.ROUND_CEIL
            );

            if (needed.isZero()) continue;

            suggestions.push({
                branchId,
                branchCode: branch.code,
                branchName: branch.name,
                ingredientId: ingredient.id,
                ingredientCode: ingredient.code,
                ingredientName: ingredient.name,
                unit: ingredient.unit,
                onHand,
                forecast,
                needed,
                allocated: ZERO,
                samples: recent.length,
                method,
            });
        }
    }

    // Divide limited source inventory proportionally among
    // destination branches that need the same ingredient.
    for (const ingredient of ingredients) {
        const rows = suggestions.filter(
            item => item.ingredientId === ingredient.id
        );

        if (rows.length === 0) continue;

        const totalNeed = rows.reduce(
            (sum, item) => sum.plus(item.needed),
            ZERO
        );

        const sourceStock = balanceMap.get(
            balanceKey(sourceBranchId, ingredient.id)
        ) ?? ZERO;

        const places = ingredient.unit === 'piece' ? 0 : 6;
        const step = ingredient.unit === 'piece'
            ? new Prisma.Decimal(1)
            : new Prisma.Decimal('0.000001');

        const usableStock = sourceStock.toDecimalPlaces(
            places,
            Prisma.Decimal.ROUND_DOWN
        );

        const supply = usableStock.lt(totalNeed)
            ? usableStock
            : totalNeed;

        if (supply.lte(0)) continue;

        const fractions = rows.map(row => {
            const raw = supply.mul(row.needed).div(totalNeed);
            const allocated = raw.toDecimalPlaces(
                places,
                Prisma.Decimal.ROUND_DOWN
            );

            row.allocated = allocated;

            return {
                row,
                fraction: raw.minus(allocated),
            };
        });

        let remaining = supply.minus(
            rows.reduce(
                (sum, item) => sum.plus(item.allocated),
                ZERO
            )
        );

        fractions.sort((a, b) =>
            b.fraction.comparedTo(a.fraction)
        );

        for (const entry of fractions) {
            if (remaining.lt(step)) break;

            if (
                entry.row.needed.minus(entry.row.allocated)
                    .gte(step)
            ) {
                entry.row.allocated =
                    entry.row.allocated.plus(step);

                remaining = remaining.minus(step);
            }
        }
    }

    const sourceBranch = branchMap.get(sourceBranchId)!;

    return {
        businessDate: targetKey,
        shift,
        dayType: targetDayType,
        sourceBranch: {
            id: sourceBranch.id,
            code: sourceBranch.code,
            name: sourceBranch.name,
        },
        historyWindowDays: 90,
        safetyMultiplier: '1.20',
        recommendations: suggestions.map(row => ({
            destinationBranchId: row.branchId,
            destinationBranchCode: row.branchCode,
            destinationBranchName: row.branchName,
            ingredientId: row.ingredientId,
            ingredientCode: row.ingredientCode,
            ingredientName: row.ingredientName,
            unit: row.unit,
            onHand: row.onHand.toFixed(6),
            predictedConsumption: row.forecast.toFixed(6),
            requestedQuantity: row.needed.toFixed(6),
            proposedDeliveryQuantity: row.allocated.toFixed(6),
            unfulfilledQuantity:
                row.needed.minus(row.allocated).toFixed(6),
            historySamples: row.samples,
            forecastMethod: row.method,
            deliverBefore: {
                businessDate: targetKey,
                shift,
            },
        })),
        notes: [
            'Recommendations require warehouse approval.',
            'Consumption includes unexplained stock loss.',
            'Sparse history uses heuristic or minimum stock.',
            'Delivery times must follow branch shift schedules.',
        ],
    };
}
