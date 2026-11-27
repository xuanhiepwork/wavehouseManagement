import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_CAMERA_ROUTE, LIVE_TAB_ROUTES, resolveLiveTab } from '../src/navigation/doclap-tabs.ts';

test('five visible slots include one primary Camera action', () => {
  assert.deepEqual(Object.keys(LIVE_TAB_ROUTES), ['home', 'work', 'history', 'account']);
  assert.equal(LIVE_CAMERA_ROUTE, '/camera');
  assert.deepEqual(Object.values(LIVE_TAB_ROUTES), ['/', '/work', '/history', '/account']);
});

test('real top-level routes select the correct non-Camera tab', () => {
  assert.equal(resolveLiveTab('/'), 'home');
  assert.equal(resolveLiveTab('/work'), 'work');
  assert.equal(resolveLiveTab('/history'), 'history');
  assert.equal(resolveLiveTab('/account'), 'account');
  assert.equal(resolveLiveTab('/work/'), 'work');
});

test('existing field and catalogue detail routes keep Work selected', () => {
  for (const path of [
    '/field/sales', '/field/count/123', '/field/trip/123', '/field/manager',
    '/ingredients', '/ingredients/123', '/products', '/products/123',
    '/recipes', '/recipes/123',
  ]) {
    assert.equal(resolveLiveTab(path), 'work', path);
  }
});

test('Camera is an action, and unrelated routes select no tab', () => {
  for (const path of ['/camera', '/doclap-preview', '/not-a-route', '/fieldwork']) {
    assert.equal(resolveLiveTab(path), null, path);
  }
});
