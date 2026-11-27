import assert from 'node:assert/strict';
import test from 'node:test';
import type { MobileUser } from '../src/auth/session.ts';
import { historyItemsFor, roleLabel, suggestedItems, workItemsFor } from '../src/navigation/work-items.ts';

function example(role: MobileUser['role'], workKind: MobileUser['workKind']): MobileUser {
  return { id: '12345678-1234-1234-1234-123456789abc', email: 'staff@example.test',
    displayName: 'Nhân viên', role, workKind, areaId: null, branchId: null };
}
const route = (items: ReturnType<typeof workItemsFor>, path: string) => items.some(item => item.href === path);

test('sales staff sees core booth work without manager approval or courier trip entry', () => {
  const items = workItemsFor(example('STAFF', 'SALES'));
  assert.equal(route(items, '/field/sales'), true);
  assert.equal(route(items, '/field/receiving'), true);
  assert.equal(route(items, '/field/inventory'), true);
  assert.equal(route(items, '/field/roster'), false);
  assert.equal(route(items, '/field/deliveries'), false);
});
test('courier only sees the delivery and schedule entry points', () => {
  assert.deepEqual(workItemsFor(example('STAFF', 'KITCHEN_DELIVERY')).map(x => x.href),
    ['/field/deliveries', '/field/schedule']);
});
test('branch manager sees approvals and roster but not admin distribution', () => {
  const items = workItemsFor(example('BRANCH_MANAGER', null));
  assert.equal(route(items, '/field/roster'), true);
  assert.equal(route(items, '/field/deliveries'), false);
});
test('admin can see distribution while unassigned staff receives no operational shortcuts', () => {
  assert.equal(route(workItemsFor(example('ADMIN', null)), '/field/deliveries'), true);
  assert.equal(workItemsFor(example('STAFF', null)).length, 0);
});
test('recommended read-only catalogue links exist for every signed-in role', () => {
  assert.deepEqual(suggestedItems().map(x => x.href), ['/ingredients', '/products', '/recipes']);
});
test('history links point to existing business list routes rather than inventing a feed', () => {
  assert.deepEqual(historyItemsFor(example('STAFF', 'KITCHEN_DELIVERY')).map(x => x.href), ['/field/deliveries']);
  assert.equal(route(historyItemsFor(example('STAFF', 'SALES')), '/field/sales'), true);
});
test('user-facing role labels are contextual', () => {
  assert.equal(roleLabel(example('STAFF', 'SALES')), 'Nhân viên bán hàng');
  assert.equal(roleLabel(example('STAFF', 'KITCHEN_DELIVERY')), 'Nhân viên giao hàng');
  assert.equal(roleLabel(example('BRANCH_MANAGER', null)), 'Quản lý khu');
});
