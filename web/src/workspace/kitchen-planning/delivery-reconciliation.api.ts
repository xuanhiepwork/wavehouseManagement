import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type ReconciliationCase = {
    id: string; status: 'OPEN'|'RESOLVED'; classification: string|null; resolutionNote: string|null;
    branchId: string; branch: { code:string; name:string; areaId:string|null };
    trip: { code:string; warehouse: { code:string } };
    items: { ingredientId:string; ingredient:{code:string;name:string;unit:string};
        plannedQuantity:string; receivedQuantity:string; damagedQuantity:string;
        missingQuantity:string; recoveredQuantity:string; outstandingQuantity:string }[];
};
export type RecoveryRequest = {
    id: string; discrepancyId:string; branchId:string; submissionKey:string;
    status: 'SUBMITTED'|'POSTED'|'REJECTED'; evidence:string;
    createdById:string; reviewedById:string|null; reviewNote:string|null;
    createdAt:string; reviewedAt:string|null;
    branch:{code:string;name:string;areaId:string|null};
    createdBy:{displayName:string}; reviewedBy:{displayName:string}|null;
    discrepancy:{status:string;classification:string|null;stop:{receivedById:string|null;trip:{code:string;businessDate:string}}};
    lines:{ingredientId:string;quantity:string;ingredient:{code:string;name:string;unit:string}}[];
    events:{action:string;note:string|null;createdAt:string;actor:{displayName:string}}[];
};
export const deliveryReconciliationApi = {
    report: (session: AuthSession, businessDate: string) =>
        apiRequest<{items:ReconciliationCase[]}>(session, `/delivery-reconciliation/report?businessDate=${encodeURIComponent(businessDate)}`),
    requests: (session: AuthSession, businessDate: string) =>
        apiRequest<{items:RecoveryRequest[]}>(session, `/delivery-reconciliation/requests?businessDate=${encodeURIComponent(businessDate)}`),
    submit: (session: AuthSession, body: {submissionKey:string;discrepancyId:string;evidence:string;
        lines:{ingredientId:string;quantity:string}[]}) =>
        apiRequest<{data:RecoveryRequest}>(session, '/delivery-reconciliation/requests', {method:'POST',body}),
    review: (session: AuthSession, id:string, decision:'POSTED'|'REJECTED', note:string) =>
        apiRequest<{data:RecoveryRequest}>(session, `/delivery-reconciliation/requests/${encodeURIComponent(id)}/review`,
            {method:'POST',body:{decision,note}}),
};
