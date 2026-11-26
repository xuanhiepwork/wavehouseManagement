const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const Module = require('node:module');
// A successful smoke proves the complete app import graph works without MongoDB.
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (/^(mongoose|mongodb)(\/|$)/.test(name)) throw new Error('Unexpected MongoDB runtime dependency');
    return originalLoad.call(this, name, ...args);
};
const { loadPostgresEnvironment } = require('../dist/config/postgres');
const { createPrismaRuntime } = require('../dist/db/prisma');
const { createApp } = require('../dist/app');
const { hashPassword } = require('../dist/services/password.service');

async function main() {
    loadPostgresEnvironment();
    const runtime = createPrismaRuntime({ ...process.env, POSTGRES_READ_ONLY: 'true' });
    let application;
    try {
        await runtime.connect();
        const user = await runtime.client.user.findFirst({ where: { role: 'ADMIN', isActive: true },
            select: { id: true, role: true, branchId: true, email: true, displayName: true, isActive: true } });
        if (!user) throw new Error('An existing active admin is required for the read-only fixture');
        // Transient login fixture only: never read a real password hash, alter an
        // account, persist a session or change production authentication code.
        const email = `${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
        const fixture = { ...user, email, passwordHash: await hashPassword(password), branch: null };
        const authPrisma = new Proxy(runtime.client, { get(target, key) {
            if (key !== 'user') return Reflect.get(target, key);
            return new Proxy(target.user, { get(delegate, method) {
                if (method !== 'findUnique') return Reflect.get(delegate, method);
                return args => args.where.email === email ? Promise.resolve(fixture) : delegate.findUnique(args);
            } });
        } });
        application = createApp(() => runtime.ready(), {
            authPrisma,
            postgresIngredients: require('../dist/services/ingredient.postgres.service').createPostgresIngredientService(runtime.client),
            postgresProducts: require('../dist/services/product.postgres.service').createPostgresProductService(runtime.client),
            postgresRecipes: require('../dist/services/recipe.postgres.service').createPostgresRecipeService(runtime.client),
        });
        await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${application.server.address().port}`;
        const health = await fetch(base + '/health'); assert.equal(health.status, 200);
        console.log('GET /health -> 200; MongoDB imports blocked; PostgreSQL session read-only');
        assert.equal((await fetch(base + '/api/ingredients')).status, 401);
        const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.equal(login.status, 200); const { token } = await login.json();
        const headers = { Authorization: `Bearer ${token}` };
        console.log('Authentication: transient local login fixture; subsequent guards reread the real user; no credentials printed.');
        let blocked = 0;
        for (const path of ['/api/auth/me', '/api/ingredients', '/api/products', '/api/recipes', '/api/branches', '/api/users',
            `/api/inventory/balances?branchId=${randomUUID()}`, '/api/goods-receipts', '/api/stock-issues', '/api/stock-transfers',
            '/api/transfer-receipts', '/api/sales-reports', '/api/shift-stock-counts', '/api/dashboard/summary']) {
            const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(15000) });
            console.log(`GET ${path.split('?')[0]} -> ${response.status}`);
            if (response.status >= 500) blocked++;
            else assert.equal(response.status, 200, path);
            await response.body?.cancel();
        }
        assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers })).status, 204);
        console.log(`Read-only smoke complete; ${blocked} endpoint(s) blocked by database/schema/permissions. No CRUD writes attempted.`);
        if (blocked) process.exitCode = 2;
    } finally {
        if (application) await new Promise(resolve => application.io.close(resolve));
        await runtime.close();
    }
}
main().catch(() => { console.error('Read-only smoke failed; private details omitted.'); process.exitCode = 1; });
