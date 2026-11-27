import assert from 'node:assert/strict';
import test from 'node:test';
import type { MobileUser } from '../src/auth/session.ts';
import { displayBusinessDay, liveHomeFor } from '../src/field/home-model.ts';

function account(role: MobileUser['role'], workKind: MobileUser['workKind'] = null): MobileUser {
  return { id: 'user', email: 'employee@example.test', displayName: 'Nhân viên',
    role, workKind, branchId: null, areaId: null };
}

test('sales homepage uses authorized real feature routes without invented workflow links', () => {
  const model = liveHomeFor(account('STAFF', 'SALES'));
  assert.deepEqual(model.work.map(item => item.href),
    ['/field/sales', '/field/receiving', '/field/inventory', '/field/schedule']);
  assert.equal(model.roleLabel, 'Nhân viên bán hàng');
});

test('delivery homepage only exposes delivery and schedule actions', () => {
  const model = liveHomeFor(account('STAFF', 'KITCHEN_DELIVERY'));
  assert.deepEqual(model.work.map(item => item.href), ['/field/deliveries', '/field/schedule']);
  assert.match(model.heroDescription, /dừng xe an toàn/);
});

test('manager and admin actions preserve existing permission-scoped destinations', () => {
  const manager = liveHomeFor(account('BRANCH_MANAGER'));
  const admin = liveHomeFor(account('ADMIN'));
  assert.ok(manager.work.some(item => item.href === '/field/roster'));
  assert.ok(!manager.work.some(item => item.href === '/field/deliveries'));
  assert.ok(admin.work.some(item => item.href === '/field/deliveries'));
  assert.equal(manager.roleLabel, 'Quản lý khu');
});

test('unassigned staff receives no operational shortcuts', () => {
  const model = liveHomeFor(account('STAFF'));
  assert.deepEqual(model.work, []);
  assert.equal(model.roleLabel, 'Nhân viên');
});

test('recommendations link only to existing read-only catalogue routes', () => {
  const routes = liveHomeFor(account('STAFF', 'SALES')).recommendations.map(item => item.href);
  assert.deepEqual(routes, ['/ingredients', '/products', '/recipes']);
});

test('business date uses local ISO day without UTC conversion', () => {
  assert.equal(displayBusinessDay('2026-11-27'), '27/11/2026');
  assert.equal(displayBusinessDay('today'), 'today');
});
