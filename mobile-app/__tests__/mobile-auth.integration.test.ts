import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { createMobileAuthClient, MobileAuthError } from '../src/auth/auth.api.ts';
import { beginAuthSession, clearAuthSession, currentAccessToken, getAuthSnapshot } from '../src/auth/session.ts';
import { createCatalogClient } from '../src/api/catalog.ts';
import { ingredient, ingredientId } from './fixtures/catalog.ts';

const baseUrl = 'http://127.0.0.1:5001/api';
const accessToken = 'A'.repeat(43);
const user = {
  id: '12345678-1234-1234-1234-123456789abc',
  email: 'manager@example.test', displayName: 'Manager',
  role: 'BRANCH_MANAGER' as const, branchId: null,
  areaId: '22345678-1234-1234-1234-123456789abc', workKind: null,
};
const loginPayload = { token: accessToken, tokenType: 'Bearer', expiresIn: 28800, user };
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
afterEach(() => { clearAuthSession(); mock.restoreAll(); });

describe('Mobile Backend authentication contract', () => {
  it('signs in with POST JSON and keeps the Bearer token only in memory', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response(loginPayload));
    const result = await createMobileAuthClient({ baseUrl, fetch }).signIn('manager@example.test', 'pass123');
    assert.deepEqual(result, user);
    assert.equal(currentAccessToken(), accessToken);
    assert.deepEqual(getAuthSnapshot().user, user);
    assert.equal(fetch.mock.calls.length, 1);
    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(url, `${baseUrl}/auth/login`);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { email: 'manager@example.test', password: 'pass123' });
    assert.ok(!JSON.stringify(getAuthSnapshot()).includes(accessToken), 'UI snapshot must not expose token');
  });
  it('adds Bearer only to active-session Catalog GETs without changing the API contract', async () => {
    beginAuthSession(accessToken, user);
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response({ data: ingredient }));
    const answer = await createCatalogClient({ baseUrl, fetch }).ingredients.detail(ingredientId);
    assert.equal(answer.data._id, ingredientId);
    assert.deepEqual(fetch.mock.calls[0].arguments[1]?.headers,
      { Accept: 'application/json', Authorization: `Bearer ${accessToken}` });
    assert.equal(fetch.mock.calls[0].arguments[1]?.method, 'GET');
  });
  it('returns to signed-out state after a 401 from the current session', async () => {
    beginAuthSession(accessToken, user);
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response({ error: 'Unauthorized' }, 401));
    await assert.rejects(createCatalogClient({ baseUrl, fetch }).ingredients.detail(ingredientId), error => {
      assert.equal((error as { status?: number }).status, 401);
      assert.ok(!String(error).includes(accessToken));
      return true;
    });
    assert.equal(currentAccessToken(), null);
    assert.equal(getAuthSnapshot().user, null);
  });
  it('never lets an old 401 log out a newer session', async () => {
    beginAuthSession(accessToken, user);
    const fetch = mock.fn<typeof globalThis.fetch>(async () => {
      beginAuthSession('B'.repeat(43), user);
      return response({ error: 'Unauthorized' }, 401);
    });
    await assert.rejects(createCatalogClient({ baseUrl, fetch }).products.list(), { status: 401 });
    assert.equal(currentAccessToken(), 'B'.repeat(43));
  });
  it('clears local credentials immediately, then attempts server logout', async () => {
    beginAuthSession(accessToken, user);
    const fetch = mock.fn<typeof globalThis.fetch>(async () => {
      assert.equal(currentAccessToken(), null);
      return new Response(null, { status: 204 });
    });
    await createMobileAuthClient({ baseUrl, fetch }).signOut();
    assert.equal(fetch.mock.calls[0].arguments[0], `${baseUrl}/auth/logout`);
    assert.deepEqual(fetch.mock.calls[0].arguments[1]?.headers, { Authorization: `Bearer ${accessToken}` });
  });
  it('rejects invalid credentials and does not save any token', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response({ error: 'Invalid email or password' }, 401));
    await assert.rejects(createMobileAuthClient({ baseUrl, fetch }).signIn('manager@example.test', 'bad'),
      (error: unknown) => error instanceof MobileAuthError && error.code === 'INVALID_CREDENTIALS' && !String(error).includes('bad'));
    assert.equal(currentAccessToken(), null);
  });
  it('rejects malformed successful login replies before saving credentials', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async () => response({ ...loginPayload, token: 'bad-token' }));
    await assert.rejects(createMobileAuthClient({ baseUrl, fetch }).signIn('manager@example.test', 'pass123'),
      { code: 'INVALID_RESPONSE' });
    assert.equal(currentAccessToken(), null);
  });
  it('fails closed on unsafe API base URLs before issuing any login request', async () => {
    const fetch = mock.fn<typeof globalThis.fetch>();
    assert.throws(() => createMobileAuthClient({ baseUrl: 'https://example.com/api', fetch }), { code: 'CONFIGURATION' });
    assert.equal(fetch.mock.calls.length, 0);
  });
});
