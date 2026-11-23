const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStockDocumentRouter } = require('../dist/routes/stock-document.routes');

const sourceBranchId = '11111111-1111-4111-8111-111111111111';
const destinationBranchId = '22222222-2222-4222-8222-222222222222';
const pieceId = '33333333-3333-4333-8333-333333333333';
const gramId = '44444444-4444-4444-8444-444444444444';
const milliliterId = '77777777-7777-4777-8777-777777777777';
const documentId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';

function fixture() {
    const calls = { create: [], update: [], itemDelete: 0, itemCreate: [] };
    const tx = {
        branch: { count: async ({ where }) => where.id.in.length },
        ingredient: {
            findMany: async ({ where }) => where.id.in
                .filter(id => [pieceId, gramId, milliliterId].includes(id))
                .map(id => ({
                    id,
                    unit: id === pieceId ? 'piece' : id === gramId ? 'g' : 'ml',
                })),
        },
        stockDocument: {
            create: async ({ data }) => {
                calls.create.push(data);
                return { id: documentId, ...data };
            },
            findFirst: async () => ({ status: 'DRAFT' }),
            updateMany: async ({ data }) => {
                calls.update.push(data);
                return { count: 1 };
            },
            findUnique: async () => ({ id: documentId, status: 'DRAFT' }),
        },
        stockDocumentItem: {
            deleteMany: async () => { calls.itemDelete++; },
            createMany: async ({ data }) => { calls.itemCreate.push(data); },
        },
    };
    const prisma = { $transaction: async work => work(tx) };
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
        res.locals.authUser = { id: actorId, role: 'ADMIN', branchId: null };
        next();
    });
    app.use('/api/stock-transfers', createStockDocumentRouter(prisma, 'TRANSFER'));
    return { app, calls };
}

async function withApi(f, run) {
    const server = f.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/stock-transfers`;
    const request = async (path, method, body) => {
        const response = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    };
    try {
        await run(request);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

function createBody(items) {
    return {
        code: 'TR-UNIT-01',
        sourceBranchId,
        destinationBranchId,
        items,
    };
}

test('transfer creation uses database units to reject fractional pieces and retain other decimals', async () => {
    const f = fixture();
    await withApi(f, async request => {
        const spoofedUnit = await request('', 'POST', createBody([
            { ingredientId: pieceId, quantity: '1.5', unit: 'g' },
        ]));
        assert.equal(spoofedUnit.status, 400);

        const rejected = await request('', 'POST', createBody([{ ingredientId: pieceId, quantity: '1.5' }]));
        assert.equal(rejected.status, 400);
        assert.equal(f.calls.create.length, 0);

        const accepted = await request('', 'POST', createBody([
            { ingredientId: pieceId, quantity: '2' },
            { ingredientId: gramId, quantity: '1.25' },
            { ingredientId: milliliterId, quantity: '0.375' },
        ]));
        assert.equal(accepted.status, 201);
        assert.deepEqual(f.calls.create[0].items.create.map(item => item.quantity), ['2', '1.25', '0.375']);
    });
});

test('draft transfer updates reject fractional pieces and preserve valid decimal quantities', async () => {
    const f = fixture();
    await withApi(f, async request => {
        const rejected = await request(`/${documentId}`, 'PATCH', {
            items: [{ ingredientId: pieceId, quantity: '0.5' }],
        });
        assert.equal(rejected.status, 400);
        assert.equal(f.calls.update.length, 0);
        assert.equal(f.calls.itemDelete, 0);

        const accepted = await request(`/${documentId}`, 'PATCH', {
            items: [
                { ingredientId: gramId, quantity: '0.125' },
                { ingredientId: milliliterId, quantity: '0.625' },
            ],
        });
        assert.equal(accepted.status, 200);
        assert.equal(f.calls.update.length, 1);
        assert.deepEqual(f.calls.itemCreate[0].map(item => item.quantity), ['0.125', '0.625']);
    });
});
