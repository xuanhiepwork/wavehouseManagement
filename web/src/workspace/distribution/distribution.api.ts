import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type DistributionBranch = { id: string; code: string; name: string };
export type DeliveryItem = {
    ingredientId: string; plannedQuantity: string; receivedQuantity: string | null; damagedQuantity: string | null;
    ingredient: { code: string; name: string; unit: string };
};
export type DeliveryStop = {
    id: string; branchId: string; stopOrder: number; status: 'PLANNED' | 'DISPATCHED' | 'RECEIVED';
    note: string | null; receivedAt: string | null;
    branch: DistributionBranch & { areaId: string | null };
    items: DeliveryItem[];
};
export type DeliveryTrip = {
    id: string; code: string; warehouseId: string; businessDate: string; courierId: string | null;
    status: 'DRAFT' | 'IN_TRANSIT' | 'COMPLETE'; note: string | null;
    receivedStops: number; createdAt: string; dispatchedAt: string | null; completedAt: string | null;
    warehouse: { code: string; name: string }; courier: { displayName: string } | null;
    stops: DeliveryStop[];
};
export type ReceiveDeliveryStop = {
    items: { ingredientId: string; receivedQuantity: string; damagedQuantity: string }[];
    note: string;
};
const enc = encodeURIComponent;
export const distributionApi = {
    branches: (session: AuthSession, date: string) =>
        apiRequest<{ items: DistributionBranch[] }>(session, `/distribution/branches?date=${enc(date)}`),
    trips: (session: AuthSession, date: string) =>
        apiRequest<{ items: DeliveryTrip[] }>(session, `/distribution/trips?date=${enc(date)}`),
    trip: (session: AuthSession, id: string) =>
        apiRequest<{ data: DeliveryTrip }>(session, `/distribution/trips/${enc(id)}`),
    dispatch: (session: AuthSession, id: string) =>
        apiRequest<{ data: DeliveryTrip }>(session, `/distribution/trips/${enc(id)}/dispatch`, { method: 'POST' }),
    receive: (session: AuthSession, id: string, body: ReceiveDeliveryStop) =>
        apiRequest<{ data: { id: string; status: string } }>(session,
            `/distribution/stops/${enc(id)}/receive`, { method: 'POST', body }),
};
