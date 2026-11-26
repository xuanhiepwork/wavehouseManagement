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
import { buildAiDemandOverlay } from '../services/ai/overlay';
import type { AiOverlay, B7DemandRow } from '../services/ai/types';
import { createEvidenceService, EvidenceError, parseAttestation, type EvidenceActor } from '../services/ai/evidence.service';
import { buildAuthorizedForecastRequest, buildTrainingExport } from '../services/ai/export.service';

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
    const evidence = createEvidenceService(prisma);

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

            // AI3 is advisory ONLY. Keep every B7 delivery proposal as-is.
            // AI5 provides explicit, human-attested recipe evidence when available.
            const baselineRows: B7DemandRow[] = data.recommendations.map(row => ({
                destinationBranchId: row.destinationBranchId,
                ingredientId: row.ingredientId,
                unit: row.unit,
                predictedConsumption: row.predictedConsumption,
            }));
            const safeFallback = (reason: string): AiOverlay => ({
                status: 'B7_FALLBACK',
                deliveryQuantitiesRemainB7: true,
                demandEstimates: baselineRows.map(row => ({
                    ...row,
                    effectiveDemand: row.predictedConsumption,
                    source: 'B7_HEURISTIC',
                    modelVersion: null,
                    uncertaintyLower: null,
                    uncertaintyUpper: null,
                    reason,
                })),
                warnings: [
                    'AI3 không thể tạo dự báo ML; kế hoạch B7 vẫn được giữ nguyên.',
                ],
            });
            let ai: AiOverlay;
            try {
                ai = await buildAiDemandOverlay({
                    businessDate: businessDate.toISOString().slice(0, 10),
                    shift,
                    baselineRows,
                    // Server-only AI5 projection. Never manufacture historical
                    // demand from the currently active Catalog recipe.
                    buildAuthorizedRequest: (destinationId, rows) => buildAuthorizedForecastRequest(
                         prisma, destinationId, businessDate.toISOString().slice(0, 10), shift, rows),
                });
                if (ai.status === 'B7_FALLBACK') {
                    ai = {
                        ...ai,
                        warnings: [
                            ...ai.warnings,
                            'Không có đủ dữ liệu lịch sử đã xác nhận hoặc chưa có mô hình AI2 phù hợp; đang dùng B7 dự phòng.',
                        ],
                    };
                }
            } catch {
                // An AI integration error must never turn an otherwise valid
                // B7 plan into an HTTP 503. No database or inventory writes.
                ai = safeFallback('AI3_OVERLAY_UNAVAILABLE');
            }
            res.json({ data, ai });
        } catch (error) {
            handleError(res, error);
        }
    });

    // AI5 ADMIN-only endpoints; this router is mounted behind requireAuth + requireAdmin.
    // Evidence attestation is a deliberate, append-only user decision, never automatic.
    const aiError = (res: Response, error: unknown) => {
        if (error instanceof EvidenceError) { res.status(error.status).json({ error: error.message }); return; }
        const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : '';
        if (['P2002', 'P2034', 'P2003', 'P2004'].includes(code ?? '')) {
            res.status(409).json({ error: 'Evidence changed or cannot be attested; reload the report.' }); return;
        }
        res.status(503).json({ error: 'AI5 evidence service temporarily unavailable' });
    };
    const range = (query: Record<string, unknown>) => {
        const from = parseDate(query.from);
        const to = parseDate(query.to);
        const branchId = query.branchId;
        if (!from || !to || from > to || to.getTime() - from.getTime() > 180 * 86400000
            || typeof branchId !== 'string' || !UUID_RE.test(branchId)) {
            throw new EvidenceError('A valid branchId and date range (maximum 180 days) are required');
        }
        return { from, to, branchId: branchId.toLowerCase() };
    };
    router.get('/ai-evidence', async (req, res) => {
        try {
            if (!onlyKeys(req.query, ['branchId', 'from', 'to'])) throw new EvidenceError('Invalid query');
            const { from, to, branchId } = range(req.query);
            res.json(await evidence.list(res.locals.authUser as EvidenceActor, branchId, from, to));
        } catch (error) { aiError(res, error); }
    });
    router.get('/ai-evidence/:id', async (req, res) => {
        try {
            const id = req.params.id;
            if (typeof id !== 'string' || !UUID_RE.test(id)) throw new EvidenceError('Invalid report ID');
            res.json(await evidence.detail(res.locals.authUser as EvidenceActor, id.toLowerCase()));
        } catch (error) { aiError(res, error); }
    });
    router.post('/ai-evidence/:id/attest', async (req, res) => {
        try {
            const id = req.params.id;
            if (typeof id !== 'string' || !UUID_RE.test(id)) throw new EvidenceError('Invalid report ID');
            res.status(201).json(await evidence.attest(res.locals.authUser as EvidenceActor,
                id.toLowerCase(), parseAttestation(req.body)));
        } catch (error) { aiError(res, error); }
    });
    router.get('/ai-training-export', async (req, res) => {
        try {
            if (!onlyKeys(req.query, ['branchId', 'from', 'to'])) throw new EvidenceError('Invalid query');
            const { from, to, branchId } = range(req.query);
            const data = await buildTrainingExport(prisma, branchId, from, to);
            // W7.3 snapshots, not personal or financial records. Explicitly prevent caching.
            res.setHeader('Cache-Control', 'no-store');
            res.json({ data });
        } catch (error) { aiError(res, error); }
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
