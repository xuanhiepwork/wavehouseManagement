const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../dist/app');
const { hashPassword } = require('../dist/services/password.service');
const { RequestError } = require('../dist/validation/request-error');

test('real app preserves login, session, roles, catalog CRUD guards and inventory branch scope without a database', async () => {
    const branchId = randomUUID();
    const user = { id: randomUUID(), email: 'fixture@example.test', displayName: 'Fixture', role: 'ADMIN', branchId: null,
        branch: null, isActive: true, passwordHash: await hashPassword('local fixture password') };
    const calls = [];
    const db = { user: { findUnique: async () => user } };
    const record = { _id: randomUUID(), code: 'FIXTURE', isActive: true };
    const ingredients = {
        listIngredients: async () => ({ data: [record], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
        createIngredient: async data => { calls.push(['create', data]); return record; },
        getIngredient: async () => { throw new RequestError(404, 'Ingredient not found'); },
        updateIngredient: async (_id, data) => { calls.push(['patch', data]); return record; },
        deleteIngredient: async () => { calls.push(['delete']); return { ...record, isActive: false }; },
    };
    const { server, io } = createApp(() => true, { authPrisma: db, postgresIngredients: ingredients, postgresProducts: {}, postgresRecipes: {} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, token, method = 'GET', body) => fetch(base + path, { method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const login = async () => {
        const response = await request('/api/auth/login', null, 'POST', { email: user.email, password: 'local fixture password' });
        assert.equal(response.status, 200); const session = await response.json();
        assert.equal(session.user.passwordHash, undefined); return session.token;
    };
    try {
        for (const path of ['/api/ingredients', '/api/products', '/api/recipes', '/api/inventory/balances', '/api/users', '/api/branches',
            '/api/goods-receipts', '/api/stock-issues', '/api/stock-transfers', '/api/transfer-receipts', '/api/sales-reports',
            '/api/shift-stock-counts', '/api/restock-planning', '/api/dashboard']) {
            assert.equal((await request(path)).status, 401, path);
        }
        assert.equal((await request('/api/auth/login', null, 'POST', {})).status, 400);
        assert.equal((await request('/api/auth/login', null, 'POST', { email: user.email, password: 'incorrect' })).status, 401);
        const token = await login();
        assert.equal((await request('/api/auth/me', token)).status, 200);
        assert.equal((await request('/api/ingredients', token)).status, 200);
        assert.equal((await request('/api/ingredients/not-an-id', token)).status, 400);
        assert.equal((await request('/api/ingredients/' + record._id, token)).status, 404);
        assert.equal((await request('/api/ingredients', token, 'POST', { code: 'fixture', name: 'Fixture', category: 'Test', unit: 'g', costPrice: '1.25' })).status, 201);
        assert.equal((await request('/api/ingredients/' + record._id, token, 'PATCH', { name: 'Updated' })).status, 200);
        const deleted = await request('/api/ingredients/' + record._id, token, 'DELETE');
        assert.equal(deleted.status, 200); assert.equal((await deleted.json()).data.isActive, false);
        assert.equal(calls.length, 3);
        // Auth middleware rereads role/branch on every request, including an existing session.
        user.role = 'STAFF'; user.branchId = branchId; user.branch = { isActive: true };
        assert.equal((await request('/api/ingredients', token)).status, 200);
        for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request('/api/ingredients/' + record._id, token, method, {})).status, 403);
        assert.equal((await request('/api/users', token)).status, 403);
        assert.equal((await request('/api/inventory/balances?branchId=' + randomUUID(), token)).status, 403);
        assert.equal(calls.length, 3, 'forbidden mutations must never call a catalog service');
        user.isActive = false;
        assert.equal((await request('/api/auth/me', token)).status, 401);
        user.isActive = true;
        const second = await login();
        assert.equal((await request('/api/auth/logout', second, 'POST')).status, 204);
        assert.equal((await request('/api/ingredients', second)).status, 401);
    } finally { await new Promise(resolve => io.close(resolve)); }
});
