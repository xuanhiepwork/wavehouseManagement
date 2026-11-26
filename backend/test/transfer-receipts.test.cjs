// Isolated unit checks only. No PrismaClient, database connection, environment loading or HTTP server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('../dist/generated/prisma/client');
const { createTransferReceiptService, parseReceivingInput } = require('../dist/services/transfer-receipt.service');
const { captureReceivingRevision, assertReceivingRevision, captureStockCountRevisions, assertStockCountRevisions,
    isReceivingTransactionConflict, lockReceivingBranches } = require('../dist/services/receiving-guard.service');

function fixture() {
    const destination = randomUUID(), source = randomUUID(), ingredientId = randomUUID();
    // G2/G4 resolves today's destination assignment in the route before invoking this service.
    // A legacy branchId by itself is no longer a grant for receiving.
    const actor = { id: randomUUID(), role: 'STAFF', branchId: destination,
        permittedReceivingBranchIds: [destination] };
    const transfer = {
        id: randomUUID(), code: 'TR-W72-UNIT', type: 'TRANSFER', status: 'POSTED',
        legacyReceivingRequired: false,
        sourceBranchId: source, destinationBranchId: destination, postedAt: new Date('2026-11-20T00:00:00Z'),
        sourceBranch: { id: source, code: 'SOURCE', name: 'Source fixture', isActive: true },
        destinationBranch: { id: destination, code: 'DEST', name: 'Destination fixture', isActive: true },
        items: [{ ingredientId, quantity: new Prisma.Decimal(10), ingredient: { code: 'I-UNIT', name: 'Fixture ingredient', unit: 'piece' } }],
    };
    let receipt = null, revision = 0, inventoryRevision = 0, pending = false, kitchenPending = false, casFailure = false;
    const writes = [];
    const inventoryTrap = new Proxy({}, { get() { throw new Error('Receiving must never call inventory persistence'); } });
    const tx = {
        inventoryBalance: inventoryTrap, inventoryMovement: inventoryTrap,
        $executeRaw: () => { throw new Error('No inventory SQL allowed'); },
        $queryRaw: async (sql, branchId) => {
            assert.match(sql.join('?'), /UPDATE "branches" SET "receiving_revision" = "receiving_revision"/);
            assert.equal(branchId, destination);
            writes.push('barrier');
            return [{ receivingRevision: revision, inventoryRevision, isActive: true }];
        },
        stockDocument: {
            findFirst: async ({ where }) => {
                if (!where.id) {
                    assert.equal(where.type, 'TRANSFER'); assert.equal(where.status, 'POSTED');
                    assert.equal(where.destinationBranchId, destination);
                    assert.deepEqual(where.OR, [{ transferReceipt: { is: null } }, { transferReceipt: { is: { status: 'DRAFT' } } }]);
                    return pending || (transfer.legacyReceivingRequired && receipt?.status !== 'CONFIRMED') ? { id: transfer.id } : null;
                }
                // Receiving service now supplies an allowlist (Prisma { in: [...] }) rather
                // than relying on the single fixed branchId on the user session.
                if (where.destinationBranchId !== undefined) {
                    const scope = where.destinationBranchId;
                    const canSeeDestination = typeof scope === 'string'
                        ? scope === destination
                        : Array.isArray(scope?.in) && scope.in.includes(destination);
                    if (!canSeeDestination) return null;
                }
                return where.id === transfer.id ? transfer : null;
            },
        },
        // G4 adds an independent pending-kitchen-delivery barrier to B6 shift counts.
        deliveryStop: { findFirst: async ({ where }) => {
            assert.equal(where.branchId, destination);
            assert.equal(where.status, 'DISPATCHED');
            assert.deepEqual(where.trip, { status: 'IN_TRANSIT' });
            return kitchenPending ? { id: randomUUID() } : null;
        } },
        branch: { update: async ({ where, data }) => {
            assert.equal(where.id, destination);
            assert.deepEqual(data, { receivingRevision: { increment: 1 } });
            revision++; writes.push('revision');
            return { receivingRevision: revision };
        } },
        transferReceipt: {
            findUnique: async () => receipt,
            findFirst: async () => receipt,
            findUniqueOrThrow: async () => receipt,
            create: async ({ data }) => {
                assert.equal(receipt, null);
                receipt = { id: randomUUID(), stockDocumentId: data.stockDocumentId, status: 'DRAFT', version: 1,
                    note: data.note, createdById: data.createdById, receivedById: null, confirmedAt: null,
                    physicalReceivedAt: data.physicalReceivedAt ?? null, legacyEvidence: data.legacyEvidence ?? null,
                    createdAt: new Date(), updatedAt: new Date(),
                    items: data.items.create.map(item => ({ ...item, receivedQuantity: new Prisma.Decimal(item.receivedQuantity),
                        damagedQuantity: new Prisma.Decimal(item.damagedQuantity), plannedQuantity: new Prisma.Decimal(item.plannedQuantity) })) };
                writes.push('create'); return receipt;
            },
            updateMany: async ({ where, data }) => {
                if (casFailure || !receipt || receipt.version !== where.version || receipt.status !== where.status) return { count: 0 };
                receipt.version++;
                if (data.note !== undefined) receipt.note = data.note;
                if (data.physicalReceivedAt !== undefined) receipt.physicalReceivedAt = data.physicalReceivedAt;
                if (data.legacyEvidence !== undefined) receipt.legacyEvidence = data.legacyEvidence;
                if (data.status) { receipt.status = data.status; receipt.receivedById = data.receivedById; receipt.confirmedAt = data.confirmedAt; }
                writes.push('receipt-update');
                return { count: 1 };
            },
        },
        transferReceiptItem: { update: async () => { writes.push('item-update'); } },
    };
    const db = { $transaction: async (work, options) => {
        assert.ok(['Serializable', 'RepeatableRead'].includes(options.isolationLevel));
        return work(tx);
    } };
    const input = (received = '10', damaged = '0', reason = null) => parseReceivingInput({
        note: 'unit fixture', items: [{ ingredientId, receivedQuantity: received, damagedQuantity: damaged, discrepancyReason: reason }],
    }, 'create');
    return { actor, transfer, input, tx, writes, service: createTransferReceiptService(db),
        get receipt() { return receipt; }, get revision() { return revision; },
        set pending(value) { pending = value; }, set kitchenPending(value) { kitchenPending = value; },
        set casFailure(value) { casFailure = value; },
        set inventoryRevision(value) { inventoryRevision = value; } };
}

test('receiving rejects actor injection, malformed decimals, duplicate ingredients and missing versions', () => {
    const f = fixture();
    for (const value of ['-1', 'NaN', 'Infinity', '1e2', '01', '1.0000001', '1000000000000', 1]) {
        assert.throws(() => f.input(value), error => error.status === 400);
    }
    assert.throws(() => parseReceivingInput({ ...f.input(), createdById: randomUUID() }, 'create'), error => error.status === 400);
    assert.throws(() => parseReceivingInput({ items: [f.input().items[0], f.input().items[0]] }, 'create'), error => error.status === 400);
    assert.throws(() => f.input('1', '2'), error => error.status === 400);
    for (const expectedVersion of [undefined, null, '1', 0, -1, 1.5]) {
        assert.throws(() => parseReceivingInput({ expectedVersion }, 'confirm'), error => error.status === 400);
    }
});

test('complete ingredient coverage, piece integrality and discrepancy explanations are enforced before saving', async () => {
    for (const makeInput of [f => f.input('9'), f => f.input('10', '1'), f => f.input('0.5', '0', 'explanation'),
        f => ({ ...f.input(), items: [{ ...f.input().items[0], ingredientId: randomUUID() }] })]) {
        const f = fixture();
        await assert.rejects(f.service.create(f.actor, f.transfer.id, makeInput(f)), error => error.status === 400);
        assert.equal(f.receipt, null);
    }
});

test('creating and replaying a receiving draft never writes inventory or duplicates the document', async () => {
    const f = fixture();
    const first = await f.service.create(f.actor, f.transfer.id, f.input('9', '1', 'one short and one damaged'));
    assert.equal(first.replayed, false);
    assert.equal(first.data.receipt.items[0].usableQuantity, '8.000000');
    assert.equal(first.data.receipt.items[0].shortageQuantity, '1.000000');
    assert.equal(first.data.receipt.items[0].overageQuantity, '0.000000');
    assert.equal(first.data.adjustsInventory, false);
    assert.equal(f.revision, 0);
    const repeat = await f.service.create(f.actor, f.transfer.id, f.input('9', '1', 'one short and one damaged'));
    assert.equal(repeat.replayed, true);
    assert.equal(repeat.data.receipt.id, first.data.receipt.id);
    assert.equal(f.writes.filter(item => item === 'create').length, 1);
    await assert.rejects(f.service.create(f.actor, f.transfer.id, f.input()), error => error.code === 'RECEIPT_ALREADY_EXISTS');
});

test('overage is distinct from damage and never creates inventory movements', async () => {
    const f = fixture();
    const result = await f.service.create(f.actor, f.transfer.id, f.input('12', '2', 'extra quantity with damaged items'));
    const item = result.data.receipt.items[0];
    assert.equal(item.usableQuantity, '10.000000');
    assert.equal(item.overageQuantity, '2.000000');
    assert.equal(item.shortageQuantity, '0.000000');
    assert.equal(f.revision, 0);
});

test('STAFF cannot read a source-only/foreign destination transfer and cannot override list scope', async () => {
    const f = fixture();
    await assert.rejects(f.service.get({ ...f.actor, branchId: f.transfer.sourceBranchId,
        permittedReceivingBranchIds: [f.transfer.sourceBranchId] }, f.transfer.id), error => error.status === 404);
    // Merely spoofing a legacy branchId must not widen an actor's assigned allowlist.
    assert.equal((await f.service.get({ ...f.actor, branchId: f.transfer.sourceBranchId }, f.transfer.id)).transfer.id, f.transfer.id);
    await assert.rejects(f.service.list(f.actor, { page: 1, destinationBranchId: f.transfer.sourceBranchId }), error => error.status === 403);
});

test('stale PATCH and stale confirmation do not overwrite the latest reviewed quantities', async () => {
    const f = fixture();
    await f.service.create(f.actor, f.transfer.id, f.input());
    await f.service.update(f.actor, f.receipt.id, parseReceivingInput({ expectedVersion: 1, note: 'new draft note' }, 'update'));
    const version = f.receipt.version;
    await assert.rejects(f.service.update(f.actor, f.receipt.id, parseReceivingInput({ expectedVersion: 1, note: 'stale note' }, 'update')),
        error => error.code === 'STALE_RECEIPT_VERSION');
    await assert.rejects(f.service.confirm(f.actor, f.receipt.id, 1), error => error.code === 'STALE_RECEIPT_VERSION');
    assert.equal(f.receipt.version, version);
    assert.equal(f.receipt.note, 'new draft note');
    assert.equal(f.revision, 0);
});

test('confirmation replay preserves original receiver/time/version and increments branch revision exactly once', async () => {
    const f = fixture();
    await f.service.create(f.actor, f.transfer.id, f.input());
    const first = await f.service.confirm(f.actor, f.receipt.id, 1);
    assert.equal(first.data.receipt.status, 'CONFIRMED');
    assert.equal(first.data.receipt.version, 2);
    assert.equal(f.revision, 1);
    assert.deepEqual(first.data.allowedActions, { canCreate: false, canEdit: false, canConfirm: false });
    const repeat = await f.service.confirm({ ...f.actor, id: randomUUID() }, f.receipt.id, 1);
    assert.equal(repeat.replayed, true);
    assert.deepEqual(repeat.data.receipt, first.data.receipt);
    assert.equal(f.revision, 1);
    await assert.rejects(f.service.update(f.actor, f.receipt.id, parseReceivingInput({ expectedVersion: 2, note: 'attempted correction' }, 'update')),
        error => error.code === 'RECEIPT_CONFIRMED');
});

test('failed confirmation CAS does not increment receiving revision', async () => {
    const f = fixture();
    await f.service.create(f.actor, f.transfer.id, f.input());
    f.casFailure = true;
    await assert.rejects(f.service.confirm(f.actor, f.receipt.id, 1), error => error.code === 'STALE_RECEIPT_VERSION');
    assert.equal(f.revision, 0);
});

test('B6 rejects historic/unconfirmed inbound transfers and rejects old or changed receiving snapshots', async () => {
    const f = fixture();
    f.pending = true;
    await assert.rejects(captureReceivingRevision(f.tx, f.actor.branchId), error => error.code === 'PENDING_TRANSFER_RECEIPTS');
    f.pending = false;
    await assert.rejects(assertReceivingRevision(f.tx, f.actor.branchId, null), error => error.code === 'RECEIVING_SNAPSHOT_CHANGED');
    const snapshot = await captureReceivingRevision(f.tx, f.actor.branchId);
    await assertReceivingRevision(f.tx, f.actor.branchId, snapshot);
    await f.service.create(f.actor, f.transfer.id, f.input());
    await f.service.confirm(f.actor, f.receipt.id, 1);
    await assert.rejects(assertReceivingRevision(f.tx, f.actor.branchId, snapshot), error => error.code === 'RECEIVING_SNAPSHOT_CHANGED');
});

test('a stale Serializable barrier is surfaced unchanged and is classifiable as a retryable conflict', async () => {
    const f = fixture();
    const conflict = { code: 'P2010', meta: { code: '40001' } };
    f.tx.$queryRaw = async () => { throw conflict; };
    await assert.rejects(captureReceivingRevision(f.tx, f.actor.branchId), error => error === conflict);
    assert.equal(isReceivingTransactionConflict(conflict), true);
    assert.equal(isReceivingTransactionConflict({ code: 'P2034' }), true);
    assert.equal(isReceivingTransactionConflict({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } }), true);
    assert.equal(isReceivingTransactionConflict({ code: 'P2010', meta: { code: '08006' } }), false);
});

test('legacy remains unresolved until authorized evidence-based retrospective confirmation; no inventory is written', async () => {
    const f = fixture(); f.transfer.legacyReceivingRequired = true;
    const manager = { ...f.actor, role: 'BRANCH_MANAGER' };
    assert.equal((await f.service.get(f.actor, f.transfer.id)).allowedActions.canCreate, false);
    await assert.rejects(f.service.create(f.actor, f.transfer.id, f.input()), error => error.code === 'LEGACY_RECONCILIATION_FORBIDDEN');
    await assert.rejects(f.service.create(manager, f.transfer.id, f.input()), error => error.code === 'INVALID_RECEIPT');
    await assert.rejects(captureStockCountRevisions(f.tx, manager.branchId), error => error.code === 'PENDING_TRANSFER_RECEIPTS');
    const input = parseReceivingInput({ ...f.input('9', '1', 'documented shortage and damage'),
        physicalReceivedAt: '2026-01-01T08:00:00.000Z', legacyEvidence: 'Signed delivery record ARCHIVE-001; quantities verified by destination manager' }, 'create');
    await f.service.create(manager, f.transfer.id, input);
    await assert.rejects(captureStockCountRevisions(f.tx, manager.branchId), error => error.code === 'PENDING_TRANSFER_RECEIPTS');
    await assert.rejects(f.service.confirm(f.actor, f.receipt.id, 1), error => error.code === 'LEGACY_RECONCILIATION_FORBIDDEN');
    const confirmed = await f.service.confirm(manager, f.receipt.id, 1);
    assert.equal(confirmed.data.receipt.physicalReceivedAt, input.physicalReceivedAt.toISOString());
    assert.equal(confirmed.data.receipt.legacyEvidence, input.legacyEvidence);
    assert.equal(confirmed.data.receipt.receivedById, manager.id);
    assert.ok(new Date(confirmed.data.receipt.confirmedAt) > input.physicalReceivedAt);
    assert.deepEqual(await captureStockCountRevisions(f.tx, manager.branchId), { receivingRevision: 1, inventoryRevision: 0 });
    const replay = await f.service.confirm(manager, f.receipt.id, 1);
    assert.deepEqual(replay.data.receipt, confirmed.data.receipt); assert.equal(f.revision, 1);
});

test('legacy metadata rejects fabrication defaults, invalid dates, unknown/blank evidence and normal-transfer injection', async () => {
    const f = fixture(); const manager = { ...f.actor, role: 'BRANCH_MANAGER' };
    for (const metadata of [{ physicalReceivedAt: '2026-02-30T08:00:00Z', legacyEvidence: 'record' },
        { physicalReceivedAt: '2026-01-01', legacyEvidence: 'record' },
        { physicalReceivedAt: '2026-01-01T08:00:00Z', legacyEvidence: '  ' },
        { legacyEvidence: 'record' }]) {
        assert.throws(() => parseReceivingInput({ ...f.input(), ...metadata }, 'create'), error => error.status === 400);
    }
    const input = parseReceivingInput({ ...f.input(), physicalReceivedAt: '2026-01-01T08:00:00Z', legacyEvidence: 'record' }, 'create');
    await assert.rejects(f.service.create(manager, f.transfer.id, input), error => error.status === 400);
    f.transfer.legacyReceivingRequired = true;
    await assert.rejects(f.service.create(manager, f.transfer.id, { ...input, physicalReceivedAt: new Date('2999-01-01T00:00:00Z') }), error => error.status === 400);
    assert.equal(f.receipt, null);
});

test('B6 inventory revision rejects offsetting movements independently of time and final balance', async () => {
    const f = fixture();
    const snapshot = await captureStockCountRevisions(f.tx, f.actor.branchId);
    await assertStockCountRevisions(f.tx, f.actor.branchId, snapshot.receivingRevision, snapshot.inventoryRevision);
    f.inventoryRevision = 2; // +q and -q, same final balance, possibly timestamps before submission.
    await assert.rejects(assertStockCountRevisions(f.tx, f.actor.branchId, snapshot.receivingRevision, snapshot.inventoryRevision),
        error => error.code === 'INVENTORY_SNAPSHOT_CHANGED');
    await assert.rejects(assertStockCountRevisions(f.tx, f.actor.branchId, snapshot.receivingRevision, null),
        error => error.code === 'INVENTORY_SNAPSHOT_CHANGED');
});

test('G4 pending kitchen deliveries block shift-count snapshots before a count can be signed', async () => {
    const f = fixture();
    f.kitchenPending = true;
    await assert.rejects(captureStockCountRevisions(f.tx, f.actor.branchId),
        error => error.code === 'PENDING_KITCHEN_DELIVERY');
    f.kitchenPending = false;
    assert.deepEqual(await captureStockCountRevisions(f.tx, f.actor.branchId),
        { receivingRevision: 0, inventoryRevision: 0 });
});

test('multi-branch barriers acquire unique branches in stable ID order', async () => {
    const ids = [randomUUID(), randomUUID()]; const seen = [];
    const tx = { $queryRaw: async (_sql, id) => { seen.push(id); return [{ receivingRevision: 0, inventoryRevision: 0, isActive: true }]; } };
    await lockReceivingBranches(tx, [ids[1], ids[0], ids[1]]);
    assert.deepEqual(seen, [...ids].sort());
});
