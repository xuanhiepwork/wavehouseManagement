/** AI3 optional demand overlay for the existing, already-authorized B7 workflow.
 *
 * The caller must compute and retain B7 planning results independently.
 * This code NEVER mutates a B7 result, inventory balance, or stock document.
 */
import { AiUnavailableError, requestAiForecast } from './client';
import type {
  AiForecastRequest, AiOverlay, B7DemandRow, EffectiveDemandRow, Shift,
} from './types';

export interface OverlayOptions {
  businessDate: string;
  shift: Shift;
  baselineRows: readonly B7DemandRow[];
  /**
   * A BACKEND-only authorized projection builder. Must use only APPROVED sales
   * revisions and HISTORICALLY VERIFIED recipe evidence. Never trust a browser
   * provided array of observations. Return null if that evidence is unavailable.
   */
  buildAuthorizedRequest: (
    destinationBranchId: string,
    rows: readonly B7DemandRow[],
  ) => Promise<AiForecastRequest | null>;
}

function b7(row: B7DemandRow, reason: string): EffectiveDemandRow {
  return {
    ...row, effectiveDemand: row.predictedConsumption,
    source: 'B7_HEURISTIC', modelVersion: null,
    uncertaintyLower: null, uncertaintyUpper: null, reason,
  };
}

function validInput(request: AiForecastRequest, branchId: string, options: OverlayOptions,
                    rows: readonly B7DemandRow[]): boolean {
  if (request.schemaVersion !== 'AI1' || request.timezone !== 'Asia/Ho_Chi_Minh'
      || request.branchId !== branchId || request.businessDate !== options.businessDate
      || request.shift !== options.shift || !Array.isArray(request.historicalObservations)
      || !request.contextualFeatures) return false;
  const expected = new Map(rows.map(row => [row.ingredientId, row.unit]));
  if (expected.size !== rows.length || request.ingredients.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const ingredient of request.ingredients) {
    if (seen.has(ingredient.id) || expected.get(ingredient.id) !== ingredient.unit) return false;
    seen.add(ingredient.id);
  }
  return true;
}

/** AI is primary for advisory *demand* where available, B7 for every other row.
 * B7 delivery quantities remain unchanged, even when some AI demands are usable.
 */
export async function buildAiDemandOverlay(options: OverlayOptions): Promise<AiOverlay> {
  const groups = new Map<string, B7DemandRow[]>();
  for (const row of options.baselineRows) {
    const existing = groups.get(row.destinationBranchId) ?? [];
    existing.push(row);
    groups.set(row.destinationBranchId, existing);
  }
  const warnings: string[] = [
    'Delivery proposals still come from B7; AI demand estimates do not recalculate dispatch quantities.',
  ];
  const results = new Map<string, EffectiveDemandRow>();
  const rowKey = (row: B7DemandRow) => `${row.destinationBranchId}/${row.ingredientId}`;
  if (groups.size > 10) {
    return {
      status: 'B7_FALLBACK', deliveryQuantitiesRemainB7: true,
      demandEstimates: options.baselineRows.map(row => b7(row, 'TOO_MANY_DESTINATIONS')),
      warnings: [...warnings, 'AI overlay supports at most ten destinations per B7 plan.'],
    };
  }
  for (const [branchId, rows] of groups) {
    let request: AiForecastRequest | null;
    try {
      request = await options.buildAuthorizedRequest(branchId, rows);
    } catch {
      request = null;
      warnings.push(`Verified historical export is unavailable for branch ${branchId}.`);
    }
    if (!request || !validInput(request, branchId, options, rows)) {
      for (const row of rows) results.set(rowKey(row), b7(row, 'NO_VERIFIED_HISTORY_EXPORT'));
      continue;
    }
    try {
      const ai = await requestAiForecast(request);
      const byIngredient = new Map(ai.predictions.map(item => [item.ingredientId, item]));
      for (const row of rows) {
        const prediction = byIngredient.get(row.ingredientId);
        results.set(rowKey(row), prediction?.status === 'AVAILABLE' && prediction.predictedDemand !== null
          ? {
              ...row, effectiveDemand: prediction.predictedDemand, source: 'AI2_ML',
              modelVersion: prediction.modelVersion,
              uncertaintyLower: prediction.uncertaintyLower,
              uncertaintyUpper: prediction.uncertaintyUpper, reason: null,
            }
          : b7(row, prediction?.status ?? 'AI_RESULT_MISSING'));
      }
    } catch (error) {
      const code = error instanceof AiUnavailableError ? error.reason : 'SERVICE_UNAVAILABLE';
      for (const row of rows) results.set(rowKey(row), b7(row, code));
      warnings.push(`AI3 unavailable for branch ${branchId}; B7 remains active (${code}).`);
    }
  }
  const demandEstimates = options.baselineRows.map(row =>
    results.get(rowKey(row)) ?? b7(row, 'AI_RESULT_MISSING'));
  const countMl = demandEstimates.filter(row => row.source === 'AI2_ML').length;
  const status = countMl === 0 ? 'B7_FALLBACK'
    : countMl === demandEstimates.length ? 'ML_AVAILABLE' : 'ML_PARTIAL';
  return { status, deliveryQuantitiesRemainB7: true, demandEstimates, warnings };
}
