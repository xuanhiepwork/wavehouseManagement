/** AI5: explicit, human-attested historical recipe evidence. No inventory mutations.
 * Attestation is add-only and limited to a fully approved W7.3 revision.
 */
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

export class EvidenceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export type EvidenceActor = { id: string; role: string; branchId: string | null };
export type AttestationPayload = {
  expectedVersion: number;
  expectedRevisionNumber: number;
  acknowledgement: 'I_VERIFIED_THE_RECIPE_USED_DURING_THIS_SHIFT';
  note: string;
  lines: { salesLineId: string; recipeId: string }[];
};
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 };
const dateText = (d: Date) => d.toISOString().slice(0, 10);
// A date-only sales report cannot prove which hour a recipe was first used.
// Require it to exist before the business day began; later activation needs
// a separate, timestamped evidence workflow (not available in W7.3).
const startOfBusinessDayVN = (date: Date) =>
  new Date(`${dateText(date)}T00:00:00+07:00`);

function requireAdmin(actor: EvidenceActor) {
  if (!actor || actor.role !== 'ADMIN' || !UUID.test(actor.id)) throw new EvidenceError('ADMIN required', 403);
}
function approved(report: {
  status: string; approvedRevisionNumber: number | null;
  submittedRevisionNumber: number | null; currentRevisionNumber: number;
  approvedAt: Date | null;
}): number {
  const n = report.approvedRevisionNumber;
  if (report.status !== 'APPROVED' || n === null || report.submittedRevisionNumber !== n
    || report.currentRevisionNumber !== n || !report.approvedAt) {
    throw new EvidenceError('Report has no consistent approved revision', 409);
  }
  return n;
}
function ingredientSnapshot(recipe: {
  ingredients: { ingredientId: string; quantity: Prisma.Decimal; ingredient: { unit: 'g' | 'ml' | 'piece' } }[];
}): { ingredientId: string; unit: string; quantity: string }[] {
  if (!recipe.ingredients.length || recipe.ingredients.length > 500) throw new EvidenceError('Recipe ingredients missing or oversized', 409);
  const result = recipe.ingredients.map(row => {
    if (!row.quantity.gt(0) || (row.ingredient.unit === 'piece' && !row.quantity.isInteger())) {
      throw new EvidenceError('Recipe quantity or piece unit is invalid', 409);
    }
    return { ingredientId: row.ingredientId, unit: row.ingredient.unit, quantity: row.quantity.toFixed(6) };
  }).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId, 'en'));
  if (new Set(result.map(row => row.ingredientId)).size !== result.length) {
    throw new EvidenceError('Duplicate recipe ingredient', 409);
  }
  return result;
}

export function parseAttestation(raw: unknown): AttestationPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EvidenceError('Invalid attestation');
  const b = raw as Record<string, unknown>;
  if (Object.keys(b).some(k => !['expectedVersion','expectedRevisionNumber','acknowledgement','note','lines'].includes(k))) {
    throw new EvidenceError('Unexpected attestation fields');
  }
  if (!Number.isSafeInteger(b.expectedVersion) || (b.expectedVersion as number) < 1
    || !Number.isSafeInteger(b.expectedRevisionNumber) || (b.expectedRevisionNumber as number) < 1
    || b.acknowledgement !== 'I_VERIFIED_THE_RECIPE_USED_DURING_THIS_SHIFT'
    || typeof b.note !== 'string' || b.note.trim().length < 10 || b.note.trim().length > 500
    || !Array.isArray(b.lines) || b.lines.length > 100) throw new EvidenceError('Incomplete attestation or confirmation');
  const lines = b.lines.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvidenceError('Invalid recipe mapping');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(k => !['salesLineId','recipeId'].includes(k))
      || typeof row.salesLineId !== 'string' || !UUID.test(row.salesLineId)
      || typeof row.recipeId !== 'string' || !UUID.test(row.recipeId)) throw new EvidenceError('Invalid recipe mapping identifiers');
    return { salesLineId: (row.salesLineId as string).toLowerCase(), recipeId: (row.recipeId as string).toLowerCase() };
  });
  if (new Set(lines.map(row => row.salesLineId)).size !== lines.length) throw new EvidenceError('Duplicate sales line');
  return { expectedVersion: b.expectedVersion as number, expectedRevisionNumber: b.expectedRevisionNumber as number,
    acknowledgement: 'I_VERIFIED_THE_RECIPE_USED_DURING_THIS_SHIFT', note: b.note.trim(), lines };
}

async function loadApproved(tx: Prisma.TransactionClient, id: string) {
  const report = await tx.salesReport.findUnique({ where: { id },
    select: { id: true, branchId: true, businessDate: true, shift: true, status: true, version: true,
      approvedAt: true, approvedRevisionNumber: true, submittedRevisionNumber: true,
      currentRevisionNumber: true, submittedById: true } });
  if (!report) throw new EvidenceError('Report not found', 404);
  const number = approved(report);
  const revision = await tx.salesReportRevision.findUnique({
    where: { reportId_number: { reportId: report.id, number } },
    include: { lines: { orderBy: { position: 'asc' }, include: { recipeEvidence: true } } },
  });
  if (!revision) throw new EvidenceError('Approved revision missing', 409);
  return { report, revision };
}

export function createEvidenceService(db: PrismaClient) {
  return {
    async list(actor: EvidenceActor, branchId: string, from: Date, to: Date) {
      requireAdmin(actor);
      const rows = await db.salesReport.findMany({ where: {
        branchId, businessDate: { gte: from, lte: to }, status: 'APPROVED',
      }, orderBy: [{ businessDate: 'desc' }, { id: 'asc' }], take: 560,
      select: { id: true, branchId: true, businessDate: true, shift: true, version: true,
        approvedRevisionNumber: true, submittedRevisionNumber: true, currentRevisionNumber: true,
        revisions: { orderBy: { number: 'desc' }, take: 1,
          select: { number: true, lines: { select: { id: true, quantity: true, recipeEvidence: { select: { id: true } } } } } },
      } });
      if (rows.length > 540) throw new EvidenceError('Please narrow the date window', 413);
      return { items: rows.map(row => {
        const current = row.revisions[0];
        const total = current?.lines.filter(l => l.quantity > 0).length ?? 0;
        const attested = current?.lines.filter(l => l.quantity > 0 && l.recipeEvidence).length ?? 0;
        return { id: row.id, branchId: row.branchId, businessDate: dateText(row.businessDate),
          shift: row.shift, version: row.version, approvedRevisionNumber: row.approvedRevisionNumber,
          totalLines: total, attestedLines: attested,
          consistent: !!current && current.number === row.currentRevisionNumber
            && row.approvedRevisionNumber === current.number && row.submittedRevisionNumber === current.number };
      }) };
    },
    async detail(actor: EvidenceActor, id: string) {
      requireAdmin(actor);
      const { report, revision } = await db.$transaction(tx => loadApproved(tx, id),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      const lines = revision.lines.filter(row => row.quantity > 0);
      const productIds = [...new Set(lines.flatMap(l => l.productId ? [l.productId] : []))];
      const recipes = await db.recipe.findMany({ where: { productVariant: { productId: { in: productIds } },
        createdAt: { lt: startOfBusinessDayVN(report.businessDate) } },
        include: { productVariant: true, ingredients: { include: { ingredient: true } } },
        orderBy: [{ version: 'desc' }, { id: 'asc' }], take: 5000 });
      return {
        data: { reportId: report.id, branchId: report.branchId, businessDate: dateText(report.businessDate),
          shift: report.shift, version: report.version, revisionNumber: revision.number,
          needsExplicitHistoricalAttestation: true,
          lines: lines.map(line => ({
            salesLineId: line.id, productId: line.productId, productName: line.productNameSnapshot,
            size: line.size, quantity: line.quantity,
            evidence: line.recipeEvidence ? { id: line.recipeEvidence.id, recipeId: line.recipeEvidence.recipeId,
              attestedAt: line.recipeEvidence.attestedAt.toISOString() } : null,
            candidates: recipes.filter(recipe => recipe.productVariant.productId === line.productId
              && recipe.productVariant.size === line.size).slice(0, 30).map(recipe => ({
                recipeId: recipe.id, version: recipe.version, createdAt: recipe.createdAt.toISOString(),
                ingredients: recipe.ingredients.map(item => ({ ingredientId: item.ingredientId,
                  name: item.ingredient.name, unit: item.ingredient.unit, quantity: item.quantity.toFixed(6) })),
              })),
          })),
        },
      };
    },
    async attest(actor: EvidenceActor, id: string, body: AttestationPayload) {
      requireAdmin(actor);
      return db.$transaction(async tx => {
        const { report, revision } = await loadApproved(tx, id);
        if (report.submittedById === actor.id) throw new EvidenceError('Cannot verify your own submitted report', 403);
        if (body.expectedVersion !== report.version || body.expectedRevisionNumber !== revision.number) {
          throw new EvidenceError('Report revision changed; reload first', 409);
        }
        const lines = revision.lines.filter(line => line.quantity > 0);
        if (lines.length !== body.lines.length) throw new EvidenceError('Every sold line must be explicitly mapped', 400);
        if (lines.some(line => !line.productId || !['S', 'M', 'L'].includes(line.size) || line.recipeEvidence)) {
          throw new EvidenceError('Line is unmappable or already attested; no overwrite permitted', 409);
        }
        const supplied = new Map(body.lines.map(row => [row.salesLineId, row.recipeId]));
        if (lines.some(line => !supplied.has(line.id))) throw new EvidenceError('Sales lines do not match approved revision', 400);
        const recipes = await tx.recipe.findMany({ where: { id: { in: [...new Set(body.lines.map(l => l.recipeId))] } },
          include: { productVariant: true, ingredients: { include: { ingredient: true } } } });
        if (recipes.length !== new Set(body.lines.map(l => l.recipeId)).size) throw new EvidenceError('Recipe not found', 409);
        const byId = new Map(recipes.map(r => [r.id, r]));
        const end = startOfBusinessDayVN(report.businessDate);
        const snapshots = lines.map(line => {
          const recipe = byId.get(supplied.get(line.id)!);
          if (!recipe || recipe.productVariant.productId !== line.productId || recipe.productVariant.size !== line.size
            || recipe.createdAt >= end || recipe.version <= 0) {
            throw new EvidenceError('Recipe must predate the business day and match the sold product/size', 409);
          }
          return { line, recipe, snapshot: ingredientSnapshot(recipe) };
        });
        for (const { line, recipe, snapshot } of snapshots) {
          await tx.salesRecipeEvidence.create({ data: {
            salesLineId: line.id, recipeId: recipe.id, recipeVersion: recipe.version,
            productVariantId: recipe.productVariantId, productId: line.productId!,
            size: recipe.productVariant.size, ingredientSnapshot: snapshot as Prisma.InputJsonValue,
            recipeCreatedAt: recipe.createdAt, attestedById: actor.id,
            attestationNote: body.note,
          } });
        }
        return { data: { reportId: report.id, approvedRevisionNumber: revision.number,
          attestedLines: snapshots.length, immutable: true, inventoryUnchanged: true } };
      }, options);
    },
  };
}
