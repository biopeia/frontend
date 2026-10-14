import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotRefresh, SNAPSHOT_REFRESH_INTERVAL_MS} from '../src/snapshot-refresh.js';

function fakeScheduler() {
  let nextId = 0;
  let time = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, {callback, due: time + delay});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const ready = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!ready) break;
        const [id, timer] = ready;
        timers.delete(id);
        time = timer.due;
        timer.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      time = end;
    },
    pending: () => timers.size,
  };
}

function fakeDocument(visibilityState = 'visible') {
  const listeners = new Map();
  return {
    visibilityState,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    changeVisibility(state) {
      this.visibilityState = state;
      listeners.get('visibilitychange')?.();
    },
  };
}

const snapshot = (deliverySequence, status = 'available') => ({
  status,
  claims: status === 'available' ? [{deliverySequence}] : [],
  scope: 'bounded_in_memory_current_subset',
  freshness: 'not_established_by_snapshot',
  coherence: 'per_message_only_no_cross_owner_snapshot_guarantee',
});

test('refreshes bounded snapshots serially at no more than once per second while visible', async () => {
  const scheduler = fakeScheduler();
  const documentRef = fakeDocument();
  const states = [];
  let reads = 0;
  const refresh = createSnapshotRefresh({
    readSnapshot: async () => snapshot(++reads),
    onState: state => states.push(state),
    documentRef,
    scheduler,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  });

  refresh.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(refresh.getState().lastCheckedAt, '2026-10-14T12:00:00.000Z');
  assert.equal(refresh.getState().freshness, 'not_established_by_snapshot');
  assert.equal(scheduler.pending(), 1);

  await scheduler.advance(SNAPSHOT_REFRESH_INTERVAL_MS - 1);
  assert.equal(reads, 1);
  await scheduler.advance(1);
  assert.equal(reads, 2);
  assert.deepEqual(refresh.getState().claims, [{deliverySequence: 2}]);
  assert.ok(states.every(state => state.claims !== undefined));
  refresh.stop();
  assert.equal(scheduler.pending(), 0);
});

test('pauses automatic reads while hidden and immediately reads a new snapshot when visible', async () => {
  const scheduler = fakeScheduler();
  const documentRef = fakeDocument();
  let reads = 0;
  const refresh = createSnapshotRefresh({
    readSnapshot: async () => snapshot(++reads),
    onState: () => {},
    documentRef,
    scheduler,
  });

  refresh.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 1);
  documentRef.changeVisibility('hidden');
  await scheduler.advance(10_000);
  assert.equal(reads, 1);
  assert.equal(scheduler.pending(), 0);

  documentRef.changeVisibility('visible');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  assert.deepEqual(refresh.getState().claims, [{deliverySequence: 2}]);
  refresh.stop();
});

test('coalesces manual requests with the in-flight read and clears claims on unavailable response', async () => {
  const scheduler = fakeScheduler();
  let resolveRead;
  let reads = 0;
  const refresh = createSnapshotRefresh({
    readSnapshot: () => {
      reads += 1;
      return new Promise(resolve => { resolveRead = resolve; });
    },
    onState: () => {},
    documentRef: fakeDocument(),
    scheduler,
  });

  refresh.start();
  assert.equal(refresh.getState().status, 'loading');
  const first = refresh.refresh();
  void refresh.refresh();
  assert.equal(reads, 1);
  resolveRead(snapshot(1));
  await first;
  assert.equal(refresh.getState().claims.length, 1);

  refresh.stop();
  const failingScheduler = fakeScheduler();
  let shouldFail = true;
  const recovering = createSnapshotRefresh({
    readSnapshot: async () => {
      if (shouldFail) throw Object.assign(new Error('bridge unavailable'), {status: 'disconnected'});
      return snapshot(2);
    },
    onState: () => {},
    documentRef: fakeDocument(),
    scheduler: failingScheduler,
    now: () => new Date('2026-10-14T12:00:02.000Z'),
  });
  recovering.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(recovering.getState().status, 'disconnected');
  assert.deepEqual(recovering.getState().claims, []);
  assert.equal(recovering.getState().lastCheckedAt, '2026-10-14T12:00:02.000Z');
  shouldFail = false;
  await failingScheduler.advance(SNAPSHOT_REFRESH_INTERVAL_MS);
  assert.equal(recovering.getState().status, 'available');
  assert.deepEqual(recovering.getState().claims, [{deliverySequence: 2}]);
  recovering.stop();
});

test('does not schedule another read after stop and rejects a faster-than-approved interval', async () => {
  assert.throws(() => createSnapshotRefresh({readSnapshot: async () => snapshot(1), onState: () => {}, intervalMs: 999}), /at least 1000 ms/);
  const scheduler = fakeScheduler();
  let reads = 0;
  const refresh = createSnapshotRefresh({readSnapshot: async () => snapshot(++reads), onState: () => {}, scheduler, documentRef: fakeDocument()});
  refresh.start();
  await Promise.resolve();
  await Promise.resolve();
  refresh.stop();
  await scheduler.advance(5000);
  assert.equal(reads, 1);
});
