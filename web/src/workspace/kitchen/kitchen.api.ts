import type { AuthSession } from '../auth';
import { apiRequest } from '../api';

export type KitchenWarehouse = { id: string; code: string; name: string; address: string | null; isActive: boolean };
export type KitchenIngredient = { id: string; code: string; name: string; unit: 'g' | 'ml' | 'piece' };
export type KitchenWorker = { id: string; displayName: string; email: string };
export type KitchenAssignment = { userId: string; isActive: boolean; user: { displayName: string; email: string } };
export type KitchenBalance = { ingredientId: string; quantity: string; updatedAt: string;
    ingredient: { code: string; name: string; unit: string } };
export type KitchenMovement = { id: string; kind: string; sourceId: string; ingredientId: string;
    delta: string; quantityAfter: string; createdAt: string; ingredient: { code: string; name: string; unit: string } };
export type KitchenReceipt = { id: string; code: string; warehouseId: string; supplierName: string | null; note: string | null;
    status: 'DRAFT' | 'POSTED'; createdAt: string; postedAt: string | null;
    items: { id: string; ingredientId: string; quantity: string; unitCost: string }[] };
export type KitchenBatch = { id: string; code: string; warehouseId: string; note: string | null;
    status: 'DRAFT' | 'POSTED'; createdAt: string; postedAt: string | null;
    inputs: { id: string; ingredientId: string; quantity: string }[];
    outputs: { id: string; ingredientId: string; quantity: string }[] };

export type KitchenReceiptInput = { code: string; supplierName: string; note: string;
    items: { ingredientId: string; quantity: string; unitCost: string }[] };
export type KitchenBatchInput = { code: string; note: string;
    inputs: { ingredientId: string; quantity: string }[];
    outputs: { ingredientId: string; quantity: string }[] };

const q = (value: string) => encodeURIComponent(value);
export const kitchenApi = {
    warehouses: (session: AuthSession) => apiRequest<{ items: KitchenWarehouse[] }>(session, '/kitchen/warehouses'),
    createWarehouse: (session: AuthSession, body: { code: string; name: string; address: string }) =>
        apiRequest<{ data: KitchenWarehouse }>(session, '/kitchen/warehouses', { method: 'POST', body }),
    ingredients: (session: AuthSession) => apiRequest<{ items: KitchenIngredient[] }>(session, '/kitchen/ingredients'),
    workers: (session: AuthSession) => apiRequest<{ items: KitchenWorker[] }>(session, '/kitchen/workers'),
    assignments: (session: AuthSession, warehouseId: string) =>
        apiRequest<{ items: KitchenAssignment[] }>(session, `/kitchen/warehouses/${q(warehouseId)}/workers`),
    assignWorker: (session: AuthSession, warehouseId: string, userId: string) =>
        apiRequest<unknown>(session, `/kitchen/warehouses/${q(warehouseId)}/workers`, { method: 'POST', body: { userId } }),
    balances: (session: AuthSession, warehouseId: string) =>
        apiRequest<{ items: KitchenBalance[] }>(session, `/kitchen/warehouses/${q(warehouseId)}/balances`),
    movements: (session: AuthSession, warehouseId: string) =>
        apiRequest<{ items: KitchenMovement[] }>(session, `/kitchen/warehouses/${q(warehouseId)}/movements`),
    receipts: (session: AuthSession, warehouseId: string) =>
        apiRequest<{ items: KitchenReceipt[] }>(session, `/kitchen/warehouses/${q(warehouseId)}/receipts`),
    createReceipt: (session: AuthSession, warehouseId: string, body: KitchenReceiptInput) =>
        apiRequest<{ data: KitchenReceipt }>(session, `/kitchen/warehouses/${q(warehouseId)}/receipts`, { method: 'POST', body }),
    postReceipt: (session: AuthSession, id: string) =>
        apiRequest<{ data: KitchenReceipt }>(session, `/kitchen/receipts/${q(id)}/post`, { method: 'POST' }),
    batches: (session: AuthSession, warehouseId: string) =>
        apiRequest<{ items: KitchenBatch[] }>(session, `/kitchen/warehouses/${q(warehouseId)}/batches`),
    createBatch: (session: AuthSession, warehouseId: string, body: KitchenBatchInput) =>
        apiRequest<{ data: KitchenBatch }>(session, `/kitchen/warehouses/${q(warehouseId)}/batches`, { method: 'POST', body }),
    postBatch: (session: AuthSession, id: string) =>
        apiRequest<{ data: KitchenBatch }>(session, `/kitchen/batches/${q(id)}/post`, { method: 'POST' }),
};
