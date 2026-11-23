/** AI3 wire contracts. These DTOs are sent only by the trusted Backend. */
export type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type IngredientUnit = 'g' | 'ml' | 'piece';
export type AiStatus = 'INSUFFICIENT_DATA' | 'MODEL_NOT_CONFIGURED' | 'AVAILABLE';

export interface AiIngredient {
  id: string;
  unit: IngredientUnit | null;
  minStock: string;
  availableAt: string;
}

export interface AiForecastRequest {
  schemaVersion: 'AI1';
  timezone: 'Asia/Ho_Chi_Minh';
  branchId: string;
  businessDate: string;
  shift: Shift;
  ingredients: AiIngredient[];
  /** Authorized, deduplicated approved-revision/verified-recipe projections only. */
  historicalObservations: Record<string, unknown>[];
  contextualFeatures: {
    calendar: Record<string, unknown>[];
    inventory: Record<string, unknown>[];
  };
}

export interface AiWarning {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
}

export interface AiPrediction {
  ingredientId: string;
  unit: IngredientUnit | null;
  status: AiStatus;
  predictedDemand: string | null;
  uncertaintyLower: string | null;
  uncertaintyUpper: string | null;
  modelVersion: string | null;
  warnings: AiWarning[];
}

export interface AiForecastResponse {
  schemaVersion: 'AI1';
  timezone: 'Asia/Ho_Chi_Minh';
  branchId: string;
  businessDate: string;
  shift: Shift;
  predictions: AiPrediction[];
  generatedAt: string;
  status: AiStatus;
  advisoryOnly: true;
}

/** Normalize B7 rows in the existing ADMIN-guarded B7 handler before calling AI3. */
export interface B7DemandRow {
  destinationBranchId: string;
  ingredientId: string;
  /** Source of truth: the B7 forecast's actual ingredient unit. */
  unit: IngredientUnit;
  /** B7 predictedConsumption is a decimal string, NOT stock-count variance. */
  predictedConsumption: string;
}

export interface EffectiveDemandRow extends B7DemandRow {
  effectiveDemand: string;
  source: 'AI2_ML' | 'B7_HEURISTIC';
  modelVersion: string | null;
  uncertaintyLower: string | null;
  uncertaintyUpper: string | null;
  reason: string | null;
}

export interface AiOverlay {
  status: 'ML_AVAILABLE' | 'ML_PARTIAL' | 'B7_FALLBACK';
  /** Advisory only; the B7 delivery proposals remain unchanged. */
  deliveryQuantitiesRemainB7: true;
  demandEstimates: EffectiveDemandRow[];
  warnings: string[];
}
