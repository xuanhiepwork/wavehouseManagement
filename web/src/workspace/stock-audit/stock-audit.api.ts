import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type AuditRow = {
    ingredientId:string;code:string;name:string;unit:string;
    branchOnHand:string;warehouseOnHand:string|null;inTransit:string;
    dispatched:string;received:string;damaged:string;missing:string;
    recovered:string;stillMissing:string;postedWriteOff:string;
};
export type StockAuditSnapshot = {
    period:{from:string;to:string};asOf:string;
    scope:{role:'ADMIN'|'BRANCH_MANAGER';
        branches:{id:string;code:string;name:string;isActive:boolean}[];
        warehouses:{id:string;code:string;name:string;isActive:boolean}[]};
    counts:{pendingStops:number;receivedStops:number;openDiscrepancies:number;
        pendingWriteOffs:number;pendingRestockPlans:number;postedWriteOffs:number;
        ledgerIssueCountShown:number;ledgerIssuesMore:boolean;deliveryAnomalyCount:number};
    notes:string[];rows:AuditRow[];
    pendingStops:{id:string;tripCode:string;businessDate:string;branchCode:string;itemCount:number}[];
    deliveryAnomalies:{kind:string;branchCode:string;tripCode:string;ingredientCode:string;message:string}[];
    ledgerIssues:{locationType:'BRANCH'|'WAREHOUSE';locationCode:string;ingredientCode:string;
        current:string;ledger:string|null;issue:string}[];
};
export const stockAuditApi = {
    snapshot:(session:AuthSession,from:string,to:string)=>apiRequest<StockAuditSnapshot>(session,
        `/stock-audit/snapshot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};
