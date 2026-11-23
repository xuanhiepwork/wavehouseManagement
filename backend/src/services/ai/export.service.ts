/** AI5: authorized, read-only W7.3 -> AI1/AI2 projections.
 * Only explicit append-only attestation is 'VERIFIED'; current Catalog never fills gaps.
 * Missing/unapproved/partial reports are NOT converted to zero demand.
 */
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import type { AiForecastRequest, B7DemandRow, IngredientUnit, Shift } from './types';
import { EvidenceError } from './evidence.service';

const MAX_REPORTS = 700;
const MAX_OBSERVATIONS = 5000;
const MAX_RECIPES = 20000;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const QUANTITY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const dateAtUTC = (s: string) => new Date(`${s}T00:00:00.000Z`);
const beforeDateVN = (s: string) => new Date(`${s}T00:00:00+07:00`);
const asInstant = (d: Date) => d.toISOString();
function maxDate(...dates: Date[]): Date { return new Date(Math.max(...dates.map(d => d.getTime()))); }

export type EvidenceItem = { ingredientId: string; unit: IngredientUnit; quantity: string };
function parseSnapshot(value: unknown): EvidenceItem[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 500) return null;
  const seen = new Set<string>();
  const result: EvidenceItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (Object.keys(obj).some(k => !['ingredientId','unit','quantity'].includes(k))
      || typeof obj.ingredientId !== 'string' || !UUID.test(obj.ingredientId)
      || !['g','ml','piece'].includes(String(obj.unit))
      || typeof obj.quantity !== 'string' || !QUANTITY.test(obj.quantity)
      || new Prisma.Decimal(obj.quantity).lte(0)
      || (obj.unit === 'piece' && !new Prisma.Decimal(obj.quantity).isInteger())
      || seen.has(obj.ingredientId)) return null;
    seen.add(obj.ingredientId);
    result.push({ ingredientId: obj.ingredientId, unit: obj.unit as IngredientUnit, quantity: obj.quantity });
  }
  return result;
}

async function history(db: PrismaClient, branchId: string, from: Date, to: Date) {
  return db.$transaction(async tx => {
    const reports = await tx.salesReport.findMany({ where: { branchId,
      businessDate: { gte: from, lte: to } },
      orderBy: [{ businessDate: 'asc' }, { id: 'asc' }], take: MAX_REPORTS + 1,
      include: { revisions: { orderBy: { number: 'desc' }, take: 1,
        include: { lines: { orderBy: { position: 'asc' }, include: { recipeEvidence: true } } } } },
    });
    if (reports.length > MAX_REPORTS) throw new EvidenceError('History export exceeds report limit', 413);
    const ingredients = await tx.ingredient.findMany({ orderBy: { id: 'asc' },
      select: { id: true, unit: true, minStock: true, createdAt: true, updatedAt: true } });
    if (ingredients.length > 5000) throw new EvidenceError('Ingredient catalog too large', 413);
    return { reports, ingredients };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}

type History = Awaited<ReturnType<typeof history>>;
type Report = History['reports'][number];
type Line = Report['revisions'][number]['lines'][number];
type Ingredient = History['ingredients'][number];
function validApproved(report: Report, revision: Report['revisions'][number] | undefined): boolean {
  return report.status === 'APPROVED' && !!report.approvedAt && !!revision
    && report.approvedRevisionNumber !== null
    && report.approvedRevisionNumber === report.submittedRevisionNumber
    && report.approvedRevisionNumber === report.currentRevisionNumber
    && revision.number === report.approvedRevisionNumber
    && revision.createdAt <= report.approvedAt;
}
function validLine(line: Line, report: Report, metadata: Map<string, Ingredient>, cutoff: Date):
  { items: EvidenceItem[]; knownAt: Date } | null {
  if (!line.productId || !['S','M','L'].includes(line.size) || !line.recipeEvidence) return null;
  const e = line.recipeEvidence;
  const startOfDay = beforeDateVN(dateKey(report.businessDate));
  if (e.productId !== line.productId || e.size !== line.size
    || e.recipeCreatedAt >= startOfDay || e.attestedAt >= cutoff
    || e.recipeVersion <= 0 || e.attestedAt < e.recipeCreatedAt) return null;
  const items = parseSnapshot(e.ingredientSnapshot);
  if (!items || items.some(item => metadata.get(item.ingredientId)?.unit !== item.unit
    || (metadata.get(item.ingredientId)?.createdAt ?? cutoff) >= cutoff)) return null;
  return { items, knownAt: e.attestedAt };
}

/** One authorized ADMIN request may use 210 complete historical same-shift slots.
 * Even when some reports are incomplete, keep only independently COMPLETE slots.
 */
export async function buildAuthorizedForecastRequest(
  db: PrismaClient, branchId: string, businessDate: string, shift: Shift,
  rows: readonly B7DemandRow[],
): Promise<AiForecastRequest | null> {
  if (!UUID.test(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !rows.length
    || rows.length > 500 || rows.some(row => row.destinationBranchId !== branchId)) return null;
  const cutoff = beforeDateVN(businessDate);
  const target = dateAtUTC(businessDate);
  if (Number.isNaN(target.getTime()) || dateKey(target) !== businessDate) return null;
  const from = new Date(target.getTime() - 210 * 86400000);
  const to = new Date(target.getTime() - 86400000);
  const { reports, ingredients } = await history(db, branchId, from, to);
  const metadata = new Map(ingredients.map(row => [row.id, row]));
  const unique = new Set(rows.map(row => row.ingredientId));
  if (unique.size !== rows.length) return null;
  const targets = rows.map(row => {
    const item = metadata.get(row.ingredientId);
    if (!item || item.unit !== row.unit || item.createdAt >= cutoff) return null;
    return { id: item.id, unit: item.unit, minStock: item.minStock.toFixed(6), availableAt: asInstant(item.createdAt) };
  });
  if (targets.some(row => row === null)) return null;
  const observations: AiForecastRequest['historicalObservations'] = [];
  for (const report of reports) {
    const revision = report.revisions[0];
    if (!revision || report.shift !== shift || !validApproved(report, revision)
      || !report.approvedAt || report.approvedAt >= cutoff) continue;
    let totalSold = 0;
    let knownAt = report.approvedAt;
    let complete = true;
    const sums = new Map<string, Prisma.Decimal>();
    for (const line of revision.lines) {
      if (line.quantity < 0 || !Number.isSafeInteger(line.quantity)) { complete = false; break; }
      totalSold += line.quantity;
      if (!line.quantity) continue;
      const evidence = validLine(line, report, metadata, cutoff);
      if (!evidence) { complete = false; break; }
      knownAt = maxDate(knownAt, evidence.knownAt);
      for (const item of evidence.items) {
        const previous = sums.get(item.ingredientId) ?? new Prisma.Decimal(0);
        sums.set(item.ingredientId, previous.plus(new Prisma.Decimal(item.quantity).mul(line.quantity)));
      }
    }
    if (!complete || knownAt >= cutoff) continue;
    const availableAt = asInstant(knownAt);
    for (const row of targets) {
      if (!row) continue;
      const ingredientMeta = metadata.get(row.id)!;
      const reportEnd = new Date(beforeDateVN(dateKey(report.businessDate)).getTime() + 86400000);
      if (ingredientMeta.createdAt >= reportEnd) continue;
      const amount = sums.get(row.id) ?? new Prisma.Decimal(0);
      if (amount.lt(0) || !amount.isFinite()) continue;
      observations.push({
        branchId, businessDate: dateKey(report.businessDate), shift,
        ingredientId: row.id, unit: row.unit, theoreticalDemand: amount.toFixed(6),
        basis: 'VERIFIED_HISTORICAL_THEORETICAL', coverage: 'COMPLETE',
        availability: totalSold === 0 ? 'APPROVED_ZERO_SALES' : 'APPROVED_RECORDED_SALES',
        reportIds: [report.id], approvedReportCount: 1, quantitySold: totalSold,
        mappedQuantitySold: totalSold, availableAt, recipeCoverage: '1',
      });
      if (observations.length > MAX_OBSERVATIONS) return null;
    }
  }
  if (!observations.length) return null;
  return {
    schemaVersion: 'AI1', timezone: 'Asia/Ho_Chi_Minh', branchId, businessDate, shift,
    ingredients: targets.filter((row): row is NonNullable<typeof row> => row !== null),
    historicalObservations: observations,
    contextualFeatures: { calendar: [], inventory: [] },
  };
}

/** Offline AI1 training export. Slots are observed report slots, not an invented shift schedule. */
export async function buildTrainingExport(db: PrismaClient, branchId: string, from: Date, to: Date) {
  if (!UUID.test(branchId)) throw new EvidenceError('Invalid branch', 400);
  const exportedAt = new Date();
  const { reports, ingredients } = await history(db, branchId, from, to);
  if (!reports.length || !ingredients.length) throw new EvidenceError('No report slots or ingredients in selected range', 409);
  const metadata = new Map(ingredients.map(row => [row.id, row]));
  const historicalRecipes = new Map<string, Record<string, unknown>>();
  const records = reports.map(report => {
    const revision = report.revisions[0];
    const valid = validApproved(report, revision);
    return {
      id: report.id, branchId: report.branchId, businessDate: dateKey(report.businessDate), shift: report.shift,
      status: report.status, currentRevisionNumber: report.currentRevisionNumber,
      submittedRevisionNumber: report.submittedRevisionNumber,
      approvedRevisionNumber: report.approvedRevisionNumber,
      approvedAt: report.approvedAt?.toISOString() ?? null,
      availableAt: asInstant(report.status === 'APPROVED' && report.approvedAt ? report.approvedAt : report.updatedAt),
      revisions: !valid || !revision ? [] : [{
        id: revision.id, reportId: report.id, number: revision.number, createdAt: asInstant(revision.createdAt),
        lines: revision.lines.map(line => {
          const v = line.recipeEvidence && validLine(line, report, metadata, exportedAt);
          if (v && line.recipeEvidence && line.productId && ['S','M','L'].includes(line.size)) {
            const e = line.recipeEvidence;
            const key = `${e.recipeId}/${e.recipeVersion}`;
            const record = {
              id: e.recipeId, productVariantId: e.productVariantId, productId: e.productId,
              size: line.size, version: e.recipeVersion,
              createdAt: asInstant(e.recipeCreatedAt), availableAt: asInstant(e.attestedAt),
              ingredients: v.items,
            };
            const existing = historicalRecipes.get(key);
            if (existing && JSON.stringify(existing.ingredients) !== JSON.stringify(record.ingredients)) {
              throw new EvidenceError('Conflicting evidence snapshots for the same recipe/version', 409);
            }
            if (!existing || Date.parse(existing.availableAt as string) > e.attestedAt.getTime()) historicalRecipes.set(key, record);
          }
          return { id: line.id, productId: line.productId, size: line.size, quantity: line.quantity,
            recipeReference: v && line.recipeEvidence ? {
              recipeId: line.recipeEvidence.recipeId, recipeVersion: line.recipeEvidence.recipeVersion,
              productVariantId: line.recipeEvidence.productVariantId, evidenceId: line.recipeEvidence.id,
              availableAt: asInstant(line.recipeEvidence.attestedAt),
            } : null,
          };
        }),
      }],
    };
  });
  if (historicalRecipes.size > MAX_RECIPES) throw new EvidenceError('Historical recipe export too large', 413);
  return {
    schemaVersion: 'AI1', timezone: 'Asia/Ho_Chi_Minh', exportedAt: asInstant(exportedAt),
    expectedSlots: reports.map(r => ({ branchId: r.branchId, businessDate: dateKey(r.businessDate), shift: r.shift })),
    ingredients: ingredients.map(i => ({ id: i.id, unit: i.unit, minStock: i.minStock.toFixed(6),
      availableAt: asInstant(i.createdAt) })),
    reports: records, historicalRecipes: [...historicalRecipes.values()], currentRecipes: [],
    mappingMode: 'VERIFIED_ONLY', exportComplete: true, stockCountProxies: [],
  };
}
