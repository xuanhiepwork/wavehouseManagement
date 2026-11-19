
import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import {
    UUID_RE,
    readBody,
    onlyKeys,
} from '../utils/admin-api';
import {
    buildRestockRecommendations,
    ForecastError,
    type ForecastShift,
} from '../services/restock-forecast.service';

type DayType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

function parseDate(value: unknown): Date | null {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        return null;
    }

    return date;
}

function parseShift(value: unknown): ForecastShift | null {
    if (
        value === 'MORNING' ||
        value === 'AFTERNOON' ||
        value === 'EVENING'
    ) {
        return value;
    }

    return null;
}

function parseIds(value: unknown): string[] | null {
    if (typeof value !== 'string') return null;

    const ids = value.split(',').map(
        id => id.trim().toLowerCase()
    );

    if (
        ids.length < 1 ||
        ids.length > 10 ||
        ids.some(id => !UUID_RE.test(id)) ||
        new Set(ids).size !== ids.length
    ) {
        return null;
    }

    return ids;
}

function handleError(res: Response, error: unknown) {
    if (error instanceof ForecastError) {
        res.status(error.status).json({
            error: error.message,
        });
        return;
    }

    res.status(503).json({
        error: 'Restock planning temporarily unavailable',
    });
}

export function createRestockRecommendationRouter(
    prisma: PrismaClient
) {
    const router = Router();

    // GET /api/restock-planning/recommendations
    router.get('/recommendations', async (req, res) => {
        const businessDate = parseDate(req.query.businessDate);
        const shift = parseShift(req.query.shift);
        const sourceValue = req.query.sourceBranchId;

        const destinationBranchIds = parseIds(
            req.query.destinationBranchIds
        );

        if (
            !businessDate ||
            !shift ||
            typeof sourceValue !== 'string' ||
            !UUID_RE.test(sourceValue) ||
            !destinationBranchIds
        ) {
            res.status(400).json({
                error: 'Invalid planning parameters',
            });
            return;
        }

        const sourceBranchId = sourceValue.toLowerCase();

        if (destinationBranchIds.includes(sourceBranchId)) {
            res.status(400).json({
                error: 'Source cannot be a destination',
            });
            return;
        }

        try {
            const data = await buildRestockRecommendations(
                prisma,
                {
                    sourceBranchId,
                    destinationBranchIds,
                    businessDate,
                    shift,
                }
            );

            res.json({ data });
        } catch (error) {
            handleError(res, error);
        }
    });

    // GET /api/restock-planning/calendar?from=...&to=...
    router.get('/calendar', async (req, res) => {
        const from = parseDate(req.query.from);
        const to = parseDate(req.query.to);

        if (
            !from ||
            !to ||
            from.getTime() > to.getTime() ||
            to.getTime() - from.getTime() > 366 * 86400000
        ) {
            res.status(400).json({
                error: 'Invalid calendar range',
            });
            return;
        }

        try {
            const items = await prisma.demandCalendarOverride.findMany({
                where: {
                    businessDate: { gte: from, lte: to },
                },
                orderBy: { businessDate: 'asc' },
            });

            res.json({ items });
        } catch (error) {
            handleError(res, error);
        }
    });

    // PUT /api/restock-planning/calendar/:businessDate
    router.put('/calendar/:businessDate', async (req, res) => {
        const businessDate = parseDate(
            req.params.businessDate
        );

        const body = readBody(req.body);

        if (
            !businessDate ||
            !body ||
            !onlyKeys(body, ['dayType', 'note'])
        ) {
            res.status(400).json({
                error: 'Invalid calendar request',
            });
            return;
        }

        const dayType = body.dayType;
        const noteValue = body.note;

        if (
            (
                dayType !== 'WEEKDAY' &&
                dayType !== 'WEEKEND' &&
                dayType !== 'HOLIDAY'
            ) ||
            (
                noteValue !== undefined &&
                noteValue !== null &&
                (
                    typeof noteValue !== 'string' ||
                    noteValue.trim().length > 200
                )
            )
        ) {
            res.status(400).json({
                error: 'Invalid day type or note',
            });
            return;
        }

        const note = typeof noteValue === 'string'
            ? noteValue.trim() || null
            : null;

        const validatedType: DayType = dayType;

        try {
            const data = await prisma.demandCalendarOverride.upsert({
                where: { businessDate },
                create: {
                    businessDate,
                    dayType: validatedType,
                    note,
                },
                update: {
                    dayType: validatedType,
                    note,
                },
            });

            res.json({ data });
        } catch (error) {
            handleError(res, error);
        }
    });

    // DELETE /api/restock-planning/calendar/:businessDate
    // Revert to automatic weekday/weekend classification.
    router.delete('/calendar/:businessDate', async (req, res) => {
        const businessDate = parseDate(
            req.params.businessDate
        );

        if (!businessDate) {
            res.status(400).json({
                error: 'Invalid business date',
            });
            return;
        }

        try {
            await prisma.demandCalendarOverride.deleteMany({
                where: { businessDate },
            });

            res.json({ deleted: true });
        } catch (error) {
            handleError(res, error);
        }
    });

    return router;
}
