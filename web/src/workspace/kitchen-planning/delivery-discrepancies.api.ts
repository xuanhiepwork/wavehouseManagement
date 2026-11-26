import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type DiscrepancyRecord = {
    id: string; stopId: string; status: 'OPEN' | 'RESOLVED'; classification: string | null;
    resolutionNote: string | null; resolvedAt: string | null; createdAt: string;
    resolvedBy: { displayName: string } | null;
    stop: { branchId: string; note: string | null; receivedById: string | null; receivedAt: string | null;
        branch: { code: string; name: string; areaId: string | null };
        trip: { id: string; code: string; businessDate: string;
            warehouse: { code: string; name: string } };
        items: { ingredientId: string; plannedQuantity: string; receivedQuantity: string | null;
            damagedQuantity: string | null; ingredient: { code: string; name: string; unit: string } }[];
    };
    events: { id: string; action: string; note: string | null; createdAt: string;
        actor: { displayName: string } }[];
};
export const deliveryDiscrepancyApi = {
    list: (session: AuthSession, businessDate: string) =>
        apiRequest<{ items: DiscrepancyRecord[] }>(session,
            `/delivery-discrepancies/cases?businessDate=${encodeURIComponent(businessDate)}`),
    resolve: (session: AuthSession, id: string, classification: string, note: string) =>
        apiRequest<{ data: DiscrepancyRecord }>(session,
            `/delivery-discrepancies/cases/${encodeURIComponent(id)}/resolve`,
            { method: 'POST', body: { classification, note } }),
};
