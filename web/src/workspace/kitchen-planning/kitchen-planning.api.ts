import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type PlanningBranch = { id: string; code: string; name: string; areaId: string | null };
export type PlanningWarehouse = { id: string; code: string; name: string };
export type PlanningRecommendation = {
    destinationBranchId: string; destinationBranchCode: string; destinationBranchName: string;
    ingredientId: string; ingredientCode: string; ingredientName: string; unit: 'g' | 'ml' | 'piece';
    onHand: string; expectedIncomingQuantity: string; predictedConsumption: string;
    requestedQuantity: string; proposedDeliveryQuantity: string; unfulfilledQuantity: string;
    historySamples: number; forecastMethod: string;
};
export type KitchenPlan = {
    businessDate: string; shift: 'MORNING'; dayType: string; sourceWarehouse: PlanningWarehouse;
    historyWindowDays: number; safetyMultiplier: string; recommendations: PlanningRecommendation[]; notes: string[];
};
export type KitchenAiOverlay = {
    status: 'ML_AVAILABLE' | 'ML_PARTIAL' | 'B7_FALLBACK';
    deliveryQuantitiesRemainB7: true; warnings: string[];
    demandEstimates: { destinationBranchId: string; ingredientId: string; effectiveDemand: string;
        source: 'AI2_ML' | 'B7_HEURISTIC'; modelVersion: string | null }[];
};
export type OpsSummary = { businessDate: string; branchCount: number; pendingReceivingStops: number;
    receivedStops: number; discrepantStops: number; submittedSalesReports: number; submittedStockCounts: number };
export const kitchenPlanningApi = {
    reference: (session: AuthSession) => apiRequest<{
        warehouses: PlanningWarehouse[]; branches: PlanningBranch[]; canCreateG4Draft: boolean;
    }>(session, '/kitchen-planning/reference'),
    recommendations: (session: AuthSession, warehouseId: string, destinationBranchIds: string[],
        businessDate: string, withAi: boolean) => {
        const query = new URLSearchParams({ warehouseId, destinationBranchIds: destinationBranchIds.join(','),
            businessDate, withAi: String(withAi) });
        return apiRequest<{ data: KitchenPlan; ai: KitchenAiOverlay | null }>(session,
            `/kitchen-planning/recommendations?${query}`);
    },
    operations: (session: AuthSession, businessDate: string) =>
        apiRequest<{ data: OpsSummary }>(session,
            `/kitchen-planning/operations?businessDate=${encodeURIComponent(businessDate)}`),
};
