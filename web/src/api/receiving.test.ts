import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    calculateReceiving, confirmReceipt, createReceipt, getTransferReceiving, listPostedTransfers,
    ReceivingApiError, validQuantity, type ReceivingDetails,
} from '../workspace/receiving/receiving.api';

const destinationId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const transferId = '33333333-3333-4333-8333-333333333333';
const ingredientId = '44444444-4444-4444-8444-444444444444';
const receiptId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';
const session = {
    token: 'unit-fixture-only', user: {
        id: actorId, role: 'STAFF' as const, branchId: destinationId, email: '', displayName: '',
    }
};
const input = { note: '', items: [{ ingredientId, receivedQuantity: '10', damagedQuantity: '0', discrepancyReason: null }] };
const fetcher = vi.fn();
function details(confirmed = false): ReceivingDetails {
    const line = { ingredientId, code: 'UNIT', name: 'Fixture item', unit: 'piece' as const, plannedQuantity: '10.000000' };
    return {
        transfer: {
            id: transferId, code: 'TR-UNIT', status: 'POSTED', inventoryPosted: true, sourceBranchId: sourceId,
            legacyReceivingRequired: false,
            destinationBranchId: destinationId, sourceBranch: { id: sourceId, code: 'S', name: 'Source fixture' },
            destinationBranch: { id: destinationId, code: 'D', name: 'Destination fixture' },
            postedAt: '2026-11-20T00:00:00.000Z', items: [line]
        },
        receipt: {
            id: receiptId, stockDocumentId: transferId, status: confirmed ? 'CONFIRMED' : 'DRAFT',
            version: confirmed ? 4 : 3, note: null, createdById: actorId, receivedById: confirmed ? actorId : null,
            physicalReceivedAt: null, legacyEvidence: null,
            createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
            confirmedAt: confirmed ? '2026-11-20T00:00:00.000Z' : null, discrepancyCount: 0,
            items: [{
                ...line, receivedQuantity: '10.000000', damagedQuantity: '0.000000', usableQuantity: '10.000000',
                shortageQuantity: '0.000000', overageQuantity: '0.000000', hasDiscrepancy: false, discrepancyReason: null
            }]
        },
        receivingStatus: confirmed ? 'CONFIRMED' : 'DRAFT', adjustsInventory: false,
        allowedActions: { canCreate: false, canEdit: !confirmed, canConfirm: !confirmed },
    };
}
function response(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => {
    vi.stubGlobal('window', {
        setTimeout,
        clearTimeout,
        dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('receiving decimal calculations', () => {
    it('retains six-place precision near the Decimal(18,6) boundary', () => {
        expect(calculateReceiving('999999999999.999999', '0.000001', '999999999999.999998')).toEqual({
            usableQuantity: '999999999999.999998', shortageQuantity: '0', overageQuantity: '0.000001', hasDiscrepancy: true,
        });
    });
    it('counts damage inside received quantity and separates shortage', () => {
        expect(calculateReceiving('9', '2', '10')).toEqual({
            usableQuantity: '7', shortageQuantity: '1', overageQuantity: '0', hasDiscrepancy: true,
        });
        expect(() => calculateReceiving('1', '2', '10')).toThrow();
        expect(validQuantity('1.000000', 'piece')).toBe(true);
        expect(validQuantity('1.000001', 'piece')).toBe(false);
        for (const value of ['-1', 'NaN', '1e2', '1000000000000', '1.0000001']) expect(validQuantity(value, 'g')).toBe(false);
    });
});

describe('receiving API contracts and uncertain outcomes', () => {
    it('retains explicit legacy evidence and physical date; incomplete legacy responses require reload', async () => {
        const value = details(true); value.transfer.legacyReceivingRequired = true;
        value.receipt!.legacyEvidence = 'Archived signed record DEL-001';
        value.receipt!.physicalReceivedAt = '2026-01-01T08:00:00.000Z';
        fetcher.mockResolvedValueOnce(response({ data: value }));
        const result = await getTransferReceiving(session, transferId);
        expect(result.transfer.legacyReceivingRequired).toBe(true);
        expect(result.receipt?.legacyEvidence).toBe(value.receipt!.legacyEvidence);
        const input = {
            note: '', items: [{ ingredientId, receivedQuantity: '10', damagedQuantity: '0', discrepancyReason: null }],
            physicalReceivedAt: value.receipt!.physicalReceivedAt!, legacyEvidence: value.receipt!.legacyEvidence!
        };
        fetcher.mockResolvedValueOnce(response({ data: value }));
        await createReceipt(session, transferId, input);
        expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual(input);
        value.receipt!.legacyEvidence = null;
        fetcher.mockResolvedValueOnce(response({ data: value }));
        await expect(confirmReceipt(session, receiptId, 3)).rejects.toMatchObject({ outcomeUnknown: true });
    });
    it('reads an unreceived transfer without automatically creating a receipt', async () => {
        const value = details();
        value.receipt = null; value.receivingStatus = 'AWAITING_RECEIVING';
        value.allowedActions = { canCreate: true, canEdit: false, canConfirm: false };
        fetcher.mockResolvedValue(response({ data: value }));
        expect((await getTransferReceiving(session, transferId)).receipt).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]?.[1].method).toBe('GET');
    });
    it('sends Bearer and only the reviewed expectedVersion when confirming', async () => {
        fetcher.mockResolvedValue(response({ data: details(true), replayed: true }));
        expect((await confirmReceipt(session, receiptId, 3)).receipt?.version).toBe(4);
        const options = fetcher.mock.calls[0]?.[1];
        expect(new Headers(options.headers).get('authorization')).toBe(
            'Bearer unit-fixture-only'
        );
        expect(JSON.parse(options.body)).toEqual({ expectedVersion: 3 });
    });
    it('uses server-side destination/status filters and explicit page numbers', async () => {
        fetcher.mockResolvedValue(response({
            items: [{
                id: transferId, code: 'TR-UNIT', status: 'POSTED',
                legacyReceivingRequired: false,
                sourceBranchId: sourceId, destinationBranchId: destinationId, postedAt: null, transferReceipt: null
            }], page: 2, total: 51
        }));
        const result = await listPostedTransfers(session, destinationId, 2, 'ALL');
        const url = String(fetcher.mock.calls[0]?.[0]);
        expect(url).toContain('destinationBranchId=' + destinationId);
        expect(url).toContain('status=POSTED');
        expect(url).toContain('page=2');
        expect(result.totalPages).toBe(2);
    });
    it('reads saved receipts from the receiving endpoint with pagination', async () => {
        fetcher.mockResolvedValue(response({ items: [details(true)], page: 1, total: 1, pageSize: 50, totalPages: 1 }));
        const result = await listPostedTransfers(session, destinationId, 1, 'CONFIRMED');
        expect(fetcher.mock.calls[0]?.[0]).toContain('/transfer-receipts?');
        expect(result.items[0]?.receipt?.status).toBe('CONFIRMED');
    });
    it.each([401, 403, 404, 409])('preserves HTTP %s for UI recovery without retrying', async status => {
        fetcher.mockResolvedValue(response({ error: 'fixture failure' }, status));
        await expect(confirmReceipt(session, receiptId, 3)).rejects.toMatchObject({ status, outcomeUnknown: false });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('marks a lost write response as unknown and never automatically repeats it', async () => {
        fetcher.mockRejectedValue(new TypeError('fixture disconnect'));
        await expect(createReceipt(session, transferId, input)).rejects.toMatchObject({ outcomeUnknown: true, code: 'NETWORK' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([500, 502, 503, 504])('marks HTTP %s write outcomes as unknown', async status => {
        fetcher.mockResolvedValue(response({ error: 'fixture failure' }, status));
        await expect(confirmReceipt(session, receiptId, 3)).rejects.toMatchObject({ status, outcomeUnknown: true });
    });
    it('blocks malformed successful responses so the UI must reread canonical state', async () => {
        fetcher.mockResolvedValue(response({ data: { receipt: null } }));
        await expect(createReceipt(session, transferId, input)).rejects.toMatchObject({ outcomeUnknown: true });
    });
    it('does not accept a successful write with an absent receipt or unconfirmed result', async () => {
        const value = details();
        value.receipt = null; value.receivingStatus = 'AWAITING_RECEIVING';
        value.allowedActions = { canCreate: true, canEdit: false, canConfirm: false };
        fetcher.mockResolvedValueOnce(response({ data: value })).mockResolvedValueOnce(response({ data: details() }));
        await expect(createReceipt(session, transferId, input)).rejects.toMatchObject({ outcomeUnknown: true });
        await expect(confirmReceipt(session, receiptId, 3)).rejects.toMatchObject({ outcomeUnknown: true });
    });
    it('rejects duplicate/mismatched receiving snapshots', async () => {
        const value = details();
        value.receipt!.items.push({ ...value.receipt!.items[0]! });
        fetcher.mockResolvedValue(response({ data: value }));
        await expect(getTransferReceiving(session, transferId)).rejects.toBeInstanceOf(ReceivingApiError);
    });
});
