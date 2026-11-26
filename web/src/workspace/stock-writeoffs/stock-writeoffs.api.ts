import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type LocationType = 'BRANCH' | 'WAREHOUSE';
export type WriteOffReason = 'EXPIRED' | 'DAMAGED' | 'SPOILAGE' | 'LOSS' | 'COUNT_VARIANCE';
export type StockLocation = { id:string; code:string; name:string };
export type StockBalance = { ingredientId:string; quantity:string; ingredient:{ code:string;name:string;unit:string } };
export type StockWriteOff = {
    id:string; submissionKey:string; branchId:string|null; warehouseId:string|null;
    status:'SUBMITTED'|'POSTED'|'REJECTED'; reason:WriteOffReason; evidence:string;
    createdById:string; reviewedById:string|null; reviewedAt:string|null; createdAt:string; reviewNote:string|null;
    createdBy:{displayName:string}; reviewedBy:{displayName:string}|null;
    branch:StockLocation|null; warehouse:StockLocation|null;
    lines:{ingredientId:string;quantity:string;ingredient:{code:string;name:string;unit:string}}[];
    events:{action:string;note:string|null;createdAt:string;actor:{displayName:string}}[];
};
export const stockWriteOffApi = {
    targets: (session:AuthSession) => apiRequest<{branches:StockLocation[];warehouses:StockLocation[]}>(session,'/stock-writeoffs/targets'),
    balances: (session:AuthSession,locationType:LocationType,locationId:string) =>
        apiRequest<{items:StockBalance[]}>(session,`/stock-writeoffs/balances?locationType=${locationType}&locationId=${encodeURIComponent(locationId)}`),
    requests: (session:AuthSession) => apiRequest<{items:StockWriteOff[]}>(session,'/stock-writeoffs/requests'),
    submit: (session:AuthSession,body:{submissionKey:string;locationType:LocationType;locationId:string;
        reason:WriteOffReason;evidence:string;lines:{ingredientId:string;quantity:string}[]}) =>
        apiRequest<{data:StockWriteOff}>(session,'/stock-writeoffs/requests',{method:'POST',body}),
    review: (session:AuthSession,id:string,decision:'POSTED'|'REJECTED',note:string) =>
        apiRequest<{data:StockWriteOff}>(session,`/stock-writeoffs/requests/${encodeURIComponent(id)}/review`,{method:'POST',body:{decision,note}}),
};
