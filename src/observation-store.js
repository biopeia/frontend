import {initialSource} from './model.js';

const same = (left, right) => Object.is(left, right);

// Volatile presentation cache only. Request tokens prevent an older request
// from replacing a later request; they are not source or causal ordering.
export function createObservationStore({initialState = initialSource} = {}) {
  let state = initialState;
  let latestRequest = 0;
  let preReadState = null;
  const subscriptions = new Set();

  function notify(previous) {
    for (const subscription of subscriptions) {
      const before = subscription.select(previous);
      const after = subscription.select(state);
      if (!subscription.equal(before, after)) subscription.listener(after, state);
    }
  }

  function update(next) {
    const previous = state;
    state = Object.freeze(next);
    notify(previous);
  }

  function subscribe(select, listener, equal = same) {
    if (typeof select !== 'function' || typeof listener !== 'function') throw new TypeError('A selector and listener are required');
    const subscription = {select, listener, equal};
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  }

  return Object.freeze({
    getState: () => state,
    subscribe,
    beginRead() {
      const requestId = ++latestRequest;
      preReadState = state;
      update({...state, status: state.claims.length ? state.status : 'loading', isRefreshing: true});
      return requestId;
    },
    accept(requestId, snapshot, receivedAt) {
      if (requestId !== latestRequest) return false;
      update({...snapshot, isRefreshing: false, stale: false, lastCheckedAt: receivedAt, lastValidReceivedAt: receivedAt, lastAttemptAt: receivedAt, error: null});
      return true;
    },
    fail(requestId, status, attemptedAt) {
      if (requestId !== latestRequest) return false;
      if (state.claims.length) {
        update({...state, status: 'stale', stale: true, isRefreshing: false, unavailableStatus: status, lastAttemptAt: attemptedAt, error: status});
      } else {
        update({...state, status, claims: [], stale: false, isRefreshing: false, lastAttemptAt: attemptedAt, error: status});
      }
      return true;
    },
    cancelRead(requestId) {
      if (requestId !== latestRequest || !state.isRefreshing) return false;
      update({...preReadState, isRefreshing: false});
      preReadState = null;
      return true;
    },
  });
}
