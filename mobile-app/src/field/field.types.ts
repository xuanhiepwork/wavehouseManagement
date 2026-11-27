export type WorkShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export interface NamedPlace { id: string; code: string; name: string; isActive?: boolean }
export interface WorkAssignment {
  id: string; branchId: string; userId: string; businessDate: string; shift: WorkShift;
  status: 'SCHEDULED' | 'CANCELLED'; version: number;
  branch: NamedPlace; user: { id: string; displayName: string; areaId?: string | null };
}
export interface Availability {
  id: string; userId: string; businessDate: string; shift: WorkShift; available: boolean;
  user?: { id: string; displayName: string };
}
export interface WorkContext {
  branches: NamedPlace[]; assignments: { branchId: string; shift: WorkShift }[];
}
export interface DeliveryItem {
  ingredientId: string; plannedQuantity: string; receivedQuantity: string | null;
  damagedQuantity: string | null; ingredient: { code: string; name: string; unit: string };
}
export interface DeliveryStop {
  id: string; branchId: string; stopOrder: number;
  status: 'PLANNED' | 'DISPATCHED' | 'RECEIVED'; receivedAt: string | null;
  branch: NamedPlace; items: DeliveryItem[];
}
export interface DeliveryTrip {
  id: string; code: string; warehouseId: string; courierId: string | null;
  businessDate: string; status: 'DRAFT' | 'IN_TRANSIT' | 'COMPLETE';
  courier: { displayName: string } | null; warehouse: { code: string; name: string };
  stops: DeliveryStop[];
}
export type SalesStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
export type SalesChannel = 'CASH' | 'BANK_TRANSFER' | 'MOMO' | 'GRAB' | 'OTHER';
export interface SalesLine {
  productId: string | null; productName: string; size: 'S' | 'M' | 'L' | 'OTHER';
  quantity: number; unitPrice: string; note: string | null;
}
export interface SalesInput {
  branchId: string; businessDate: string; shift: WorkShift; note: string | null; discounts: string;
  lines: SalesLine[];
  payments: { channel: SalesChannel; collectedAmount: string; refundedAmount: string;
    platformFee: string; settlementDifference: string; note: string | null }[];
  expenses: { channel: SalesChannel; description: string; amount: string }[];
  cash: { openingCash: string; cashHandovers: string; closingCashActual: string | null };
}
export interface SalesReport {
  id: string; branchId: string; businessDate: string; shift: WorkShift; status: SalesStatus;
  version: number; currentRevisionNumber: number; submittedRevisionNumber: number | null;
  createdById: string; submittedById: string | null;
  branch: NamedPlace; returnReason: string | null;
  allowedActions: { canEdit: boolean; canSubmit: boolean; canReturn: boolean; canApprove: boolean };
  currentRevision: { number:number; note:string|null; discounts:string;
    lines: Array<{productId: string|null; productNameSnapshot: string;size: string;quantity: number;unitPriceSnapshot: string;note:string|null}>;
    payments: Array<{channel:SalesChannel;collectedAmount:string;refundedAmount:string;platformFee:string;settlementDifference:string;note:string|null}>;
    expenses: Array<{channel:SalesChannel;description:string;amount:string}>;
    cash:{openingCash:string;cashHandovers:string;closingCashActual:string|null};
    totals: { grossSales: string; netRecorded: string; salesDifference: string;expectedCash:string;cashDifference:string|null } };
}
export interface StockBalance { ingredientId: string; quantity: string; ingredient: { code: string; name: string; unit: string } }
export interface StockCountSummary { id: string; branchId: string; businessDate: string; shift: WorkShift; status: string }
export interface OperationsSummary {
  businessDate: string; branchCount: number; pendingReceivingStops: number; receivedStops: number;
  discrepantStops: number; submittedSalesReports: number; submittedStockCounts: number;
}
