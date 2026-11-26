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

// G6: saved decisions are independent from the read-only G5 B7/AI preview.
export type RestockPlanRecord = {
    id: string; areaId: string; warehouseId: string; businessDate: string; status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED';
    note: string | null; createdAt: string; reviewedAt: string | null; reviewNote: string | null;
    convertedAt: string | null; deliveryTripId: string | null; createdById: string; reviewedById: string | null;
    area: { code: string; name: string }; warehouse: { code: string; name: string };
    createdBy: { displayName: string }; reviewedBy: { displayName: string } | null;
    lines: { branchId: string; ingredientId: string; quantity: string;
        branch: { code: string; name: string }; ingredient: { code: string; name: string; unit: string } }[];
    events: { id: string; action: string; note: string | null; createdAt: string;
        actor: { displayName: string } }[];
};
export const restockApprovalApi = {
    list: (session: AuthSession, businessDate: string) => apiRequest<{ items: RestockPlanRecord[] }>(session,
        `/restock-approval/plans?businessDate=${encodeURIComponent(businessDate)}`),
    submit: (session: AuthSession, input: { submissionKey: string; warehouseId: string; businessDate: string;
        branchIds: string[]; expectedRows: { branchId: string; ingredientId: string; quantity: string }[]; note: string }) =>
        apiRequest<{ data: RestockPlanRecord }>(session,'/restock-approval/plans', { method: 'POST', body: input }),
    review: (session: AuthSession, id: string, decision: 'APPROVED' | 'REJECTED', note: string) =>
        apiRequest<{ data: RestockPlanRecord }>(session,`/restock-approval/plans/${encodeURIComponent(id)}/review`,
            { method: 'POST', body: { decision, note } }),
    convert: (session: AuthSession, id: string, code: string, courierId: string) =>
        apiRequest<{ data: { tripCode: string; tripId: string } }>(session,
            `/restock-approval/plans/${encodeURIComponent(id)}/convert`, { method: 'POST', body: { code, courierId } }),
};
