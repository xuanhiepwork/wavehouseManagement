import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogApiError } from '../src/api/catalog.errors.ts';
import { createCatalogRead } from '../src/api/catalog.read.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a new read stays idle and does not load or retry automatically', async () => {
  const read = createCatalogRead<string>();
  let notifications = 0;
  const unsubscribe = read.subscribe(() => { notifications++; });

  assert.equal(read.getSnapshot().status, 'idle');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  await read.retry();
  await Promise.resolve();

  assert.equal(read.getSnapshot().status, 'idle');
  assert.equal(notifications, 0);
  unsubscribe();
  read.dispose();
});

test('load publishes loading immediately and preserves successful values exactly', async () => {
  const read = createCatalogRead<{ quantity: string; id: string }>();
  const pending = deferred<{ quantity: string; id: string }>();
  const value = { quantity: '999999999999.999999', id: 'abcdef12-abcd-abcd-abcd-abcdef123456' };
  let signal: AbortSignal | undefined;
  const work = read.load(current => { signal = current; return pending.promise; });

  assert.equal(read.getSnapshot().status, 'loading');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  await Promise.resolve();
  assert.ok(signal);
  assert.equal(signal.aborted, false);

  pending.resolve(value);
  await assert.doesNotReject(work);
  assert.equal(read.getSnapshot().status, 'success');
  assert.deepEqual(read.getSnapshot().data, value);
  assert.equal(read.getSnapshot().error, undefined);
  read.dispose();
});

test('a replacement load clears previous successful data before it settles', async () => {
  const read = createCatalogRead<string>();
  await read.load(async () => 'old Product');
  assert.equal(read.getSnapshot().data, 'old Product');
  const pending = deferred<string>();
  const work = read.load(() => pending.promise);

  assert.equal(read.getSnapshot().status, 'loading');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  pending.resolve('new Product');
  await work;
  assert.equal(read.getSnapshot().data, 'new Product');
  read.dispose();
});

test('a replacement load clears the old read error immediately', async () => {
  const read = createCatalogRead<string>();
  await read.load(async () => { throw new CatalogApiError('NOT_FOUND', 404); });
  assert.equal(read.getSnapshot().status, 'error');
  assert.equal(read.getSnapshot().error?.code, 'NOT_FOUND');
  const pending = deferred<string>();
  const work = read.load(() => pending.promise);

  assert.equal(read.getSnapshot().status, 'loading');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  pending.resolve('reference recovered');
  await work;
  assert.equal(read.getSnapshot().status, 'success');
  read.dispose();
});

for (const staleOutcome of ['success', 'failure'] as const) {
  test(`an older ${staleOutcome} cannot replace a newer successful read or notify subscribers`, async () => {
    const read = createCatalogRead<string>();
    const older = deferred<string>();
    const newer = deferred<string>();
    let oldSignal: AbortSignal | undefined;
    let notifications = 0;
    read.subscribe(() => { notifications++; });
    const oldWork = read.load(signal => { oldSignal = signal; return older.promise; });
    await Promise.resolve();
    assert.ok(oldSignal);

    const newWork = read.load(() => newer.promise);
    assert.equal(oldSignal.aborted, true);
    newer.resolve('selected Product B');
    await newWork;
    assert.equal(read.getSnapshot().data, 'selected Product B');
    const settledNotifications = notifications;

    // This loader deliberately ignores cancellation, as a native transport might.
    if (staleOutcome === 'success') older.resolve('stale Product A');
    else older.reject(new Error('private stale transport error'));
    await assert.doesNotReject(oldWork);
    assert.equal(read.getSnapshot().status, 'success');
    assert.equal(read.getSnapshot().data, 'selected Product B');
    assert.equal(read.getSnapshot().error, undefined);
    assert.equal(notifications, settledNotifications);
    read.dispose();
  });
}

test('an older successful read cannot clear the current request error', async () => {
  const read = createCatalogRead<string>();
  const oldPending = deferred<string>();
  const oldWork = read.load(() => oldPending.promise);
  const expected = new CatalogApiError('TIMEOUT');
  await read.load(async () => { throw expected; });
  assert.equal(read.getSnapshot().status, 'error');
  assert.equal(read.getSnapshot().error?.code, 'TIMEOUT');

  oldPending.resolve('outdated success');
  await oldWork;
  assert.equal(read.getSnapshot().status, 'error');
  assert.equal(read.getSnapshot().error?.code, 'TIMEOUT');
  assert.equal(read.getSnapshot().data, undefined);
  read.dispose();
});

test('unexpected failures are sanitized and absorbed without automatic retries', async () => {
  const read = createCatalogRead<string>();
  const secret = 'http://private-user:private-password@host/database SELECT secret';
  let calls = 0;
  const work = read.load(async () => { calls++; throw new Error(secret); });

  await assert.doesNotReject(work);
  await Promise.resolve();
  const snapshot = read.getSnapshot();
  assert.equal(snapshot.status, 'error');
  assert.ok(snapshot.error instanceof CatalogApiError);
  assert.equal(snapshot.error.code, 'NETWORK');
  assert.equal(snapshot.data, undefined);
  assert.equal(String(snapshot.error).includes(secret), false);
  assert.equal(JSON.stringify(snapshot.error).includes(secret), false);
  assert.equal(snapshot.error.cause, undefined);
  assert.equal(calls, 1);
  read.dispose();
});

test('synchronous loader exceptions are absorbed into safe read state', async () => {
  const read = createCatalogRead<string>();
  let calls = 0;
  await assert.doesNotReject(read.load(() => {
    calls++;
    throw new Error('private synchronous loader details');
  }));

  assert.equal(read.getSnapshot().status, 'error');
  assert.equal(read.getSnapshot().error?.code, 'NETWORK');
  assert.equal(String(read.getSnapshot().error).includes('private synchronous loader details'), false);
  assert.equal(calls, 1);
  read.dispose();
});

test('Catalog API classifications survive read failures', async () => {
  const read = createCatalogRead<string>();
  for (const error of [new CatalogApiError('TIMEOUT'), new CatalogApiError('NOT_FOUND', 404),
    new CatalogApiError('MALFORMED_RESPONSE', 200), new CatalogApiError('SERVER_ERROR', 503)]) {
    await assert.doesNotReject(read.load(async () => { throw error; }));
    assert.equal(read.getSnapshot().status, 'error');
    assert.equal(read.getSnapshot().error?.code, error.code);
    assert.equal(read.getSnapshot().error?.status, error.status);
  }
  read.dispose();
});

test('retry explicitly invokes only the most recent loader with a fresh signal', async () => {
  const read = createCatalogRead<string>();
  let originalCalls = 0;
  let currentCalls = 0;
  const signals: AbortSignal[] = [];
  await read.load(async () => { originalCalls++; return 'initial'; });
  await read.load(async signal => {
    signals.push(signal);
    currentCalls++;
    if (currentCalls === 1) throw new CatalogApiError('NETWORK');
    return 'explicitly retried';
  });
  assert.equal(currentCalls, 1);
  assert.equal(read.getSnapshot().status, 'error');

  const retry = read.retry();
  assert.equal(read.getSnapshot().status, 'loading');
  assert.equal(read.getSnapshot().error, undefined);
  await assert.doesNotReject(retry);
  assert.equal(read.getSnapshot().data, 'explicitly retried');
  assert.equal(originalCalls, 1);
  assert.equal(currentCalls, 2);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[1].aborted, false);
  read.dispose();
});

test('cancel aborts in-flight work, resets idle, and retains its loader for explicit retry', async () => {
  const read = createCatalogRead<string>();
  const attempts = [deferred<string>(), deferred<string>()];
  const signals: AbortSignal[] = [];
  let calls = 0;
  const work = read.load(signal => { signals.push(signal); return attempts[calls++].promise; });
  await Promise.resolve();
  assert.equal(calls, 1);

  read.cancel();
  assert.equal(signals[0].aborted, true);
  assert.equal(read.getSnapshot().status, 'idle');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  attempts[0].reject(new Error('ignored abort rejection'));
  await assert.doesNotReject(work);
  assert.equal(read.getSnapshot().status, 'idle');
  assert.equal(calls, 1);

  const retry = read.retry();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(read.getSnapshot().status, 'loading');
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[1].aborted, false);
  attempts[1].resolve('loaded after cancellation');
  await retry;
  assert.equal(read.getSnapshot().data, 'loaded after cancellation');
  read.dispose();
});

test('subscriptions observe transitions and unsubscribe independently', async () => {
  const read = createCatalogRead<string>();
  const first: string[] = [];
  const second: string[] = [];
  const unsubscribeFirst = read.subscribe(() => { first.push(read.getSnapshot().status); });
  read.subscribe(() => { second.push(read.getSnapshot().status); });
  await read.load(async () => 'one');
  assert.deepEqual(first, ['loading', 'success']);
  assert.deepEqual(second, ['loading', 'success']);

  unsubscribeFirst();
  unsubscribeFirst();
  await read.load(async () => 'two');
  assert.deepEqual(first, ['loading', 'success']);
  assert.deepEqual(second, ['loading', 'success', 'loading', 'success']);
  read.dispose();
});

test('disposal from a loading subscription prevents the loader from starting', async () => {
  const read = createCatalogRead<string>();
  let calls = 0;
  let notifications = 0;
  read.subscribe(() => {
    notifications++;
    if (read.getSnapshot().status === 'loading') read.dispose();
  });

  await assert.doesNotReject(read.load(async () => { calls++; return 'must not start'; }));
  assert.equal(calls, 0);
  assert.equal(read.getSnapshot().status, 'idle');
  assert.equal(read.getSnapshot().data, undefined);
  assert.equal(read.getSnapshot().error, undefined);
  assert.equal(notifications, 1);
});

test('a replacement from a loading subscription prevents superseded work from starting', async () => {
  const read = createCatalogRead<string>();
  let replaced = false;
  let supersededCalls = 0;
  let newerCalls = 0;
  let newWork: Promise<void> | undefined;
  read.subscribe(() => {
    if (read.getSnapshot().status === 'loading' && !replaced) {
      replaced = true;
      newWork = read.load(async () => { newerCalls++; return 'newer selection'; });
    }
  });

  await assert.doesNotReject(read.load(async () => { supersededCalls++; return 'superseded selection'; }));
  assert.ok(newWork);
  await assert.doesNotReject(newWork);
  assert.equal(supersededCalls, 0);
  assert.equal(newerCalls, 1);
  assert.equal(read.getSnapshot().status, 'success');
  assert.equal(read.getSnapshot().data, 'newer selection');
  assert.equal(read.getSnapshot().error, undefined);
  read.dispose();
});

for (const lateOutcome of ['success', 'failure'] as const) {
  test(`dispose aborts reads and ignores late ${lateOutcome} without further loading or notifications`, async () => {
    const read = createCatalogRead<string>();
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    let calls = 0;
    let notifications = 0;
    read.subscribe(() => { notifications++; });
    const work = read.load(current => { calls++; signal = current; return pending.promise; });
    await Promise.resolve();
    assert.ok(signal);
    read.dispose();
    const afterDispose = notifications;
    assert.equal(signal.aborted, true);
    assert.equal(read.getSnapshot().status, 'idle');
    assert.equal(read.getSnapshot().data, undefined);
    assert.equal(read.getSnapshot().error, undefined);

    if (lateOutcome === 'success') pending.resolve('unmounted result');
    else pending.reject(new Error('unmounted private failure'));
    await assert.doesNotReject(work);
    await assert.doesNotReject(read.retry());
    await assert.doesNotReject(read.load(async () => { calls++; return 'must not run'; }));
    let lateNotifications = 0;
    read.subscribe(() => { lateNotifications++; });
    read.cancel();
    read.dispose();
    assert.equal(read.getSnapshot().status, 'idle');
    assert.equal(calls, 1);
    assert.equal(notifications, afterDispose);
    assert.equal(lateNotifications, 0);
  });
}
