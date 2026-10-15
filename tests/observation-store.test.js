import test from 'node:test';
import assert from 'node:assert/strict';
import {createObservationStore} from '../src/observation-store.js';

const claim = sequence => ({deliverySequence: sequence, family:'embodiment.body_pose'});
const snapshot = sequence => ({status:'available', claims:[claim(sequence)], scope:'bounded-current', freshness:'not_established_by_snapshot', coherence:'per-message'});

test('selective subscriptions ignore changes outside their selected value', () => {
  const store = createObservationStore();
  let claimNotifications = 0;
  let statusNotifications = 0;
  store.subscribe(state => state.claims, () => claimNotifications++);
  store.subscribe(state => state.status, () => statusNotifications++);
  const request = store.beginRead();
  assert.equal(claimNotifications, 0);
  assert.equal(statusNotifications, 1);
  store.accept(request, snapshot(1), '2026-10-15T00:00:00.000Z');
  assert.equal(claimNotifications, 1);
  assert.equal(statusNotifications, 2);
});

test('ignores obsolete request completions without treating arrival order as source order', () => {
  const store = createObservationStore();
  const oldRequest = store.beginRead();
  const newRequest = store.beginRead();
  assert.equal(store.accept(newRequest, snapshot(2), '2026-10-15T00:00:02.000Z'), true);
  assert.equal(store.accept(oldRequest, snapshot(1), '2026-10-15T00:00:03.000Z'), false);
  assert.equal(store.getState().claims[0].deliverySequence, 2);
  assert.equal(store.getState().lastValidReceivedAt, '2026-10-15T00:00:02.000Z');
});

test('retains last valid snapshot as stale on disconnect, then replaces it on recovery', () => {
  const store = createObservationStore();
  const first = store.beginRead();
  store.accept(first, snapshot(8), '2026-10-15T00:00:00.000Z');
  const second = store.beginRead();
  assert.equal(store.getState().claims[0].deliverySequence, 8);
  assert.equal(store.getState().isRefreshing, true);
  store.fail(second, 'disconnected', '2026-10-15T00:00:03.000Z');
  assert.equal(store.getState().status, 'stale');
  assert.equal(store.getState().stale, true);
  assert.equal(store.getState().unavailableStatus, 'disconnected');
  assert.equal(store.getState().claims[0].deliverySequence, 8);
  assert.equal(store.getState().lastValidReceivedAt, '2026-10-15T00:00:00.000Z');
  const third = store.beginRead();
  store.accept(third, snapshot(11), '2026-10-15T00:00:05.000Z');
  assert.equal(store.getState().stale, false);
  assert.equal(store.getState().claims[0].deliverySequence, 11);
});

test('failed first read does not invent or retain claims', () => {
  const store = createObservationStore();
  const request = store.beginRead();
  store.fail(request, 'denied', '2026-10-15T00:00:00.000Z');
  assert.equal(store.getState().status, 'denied');
  assert.equal(store.getState().claims.length, 0);
  assert.equal(store.getState().stale, false);
});
