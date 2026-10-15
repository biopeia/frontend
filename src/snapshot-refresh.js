export const SNAPSHOT_REFRESH_INTERVAL_MS = 1000;

export function createSnapshotRefresh({
  readSnapshot,
  store,
  documentRef = globalThis.document,
  scheduler = globalThis,
  intervalMs = SNAPSHOT_REFRESH_INTERVAL_MS,
  now = () => new Date(),
}) {
  if (typeof readSnapshot !== 'function' || !store || typeof store.beginRead !== 'function') {
    throw new TypeError('Snapshot refresh requires a reader and Observation store');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < SNAPSHOT_REFRESH_INTERVAL_MS) {
    throw new RangeError(`Snapshot refresh interval must be at least ${SNAPSHOT_REFRESH_INTERVAL_MS} ms`);
  }

  let timer = null;
  let inFlight = null;
  let started = false;
  let stopped = false;
  let activeController = null;
  let activeRequestId = null;

  function clearTimer() {
    if (timer !== null) { scheduler.clearTimeout(timer); timer = null; }
  }
  function scheduleNext() {
    clearTimer();
    if (stopped || !started || documentRef?.visibilityState === 'hidden') return;
    timer = scheduler.setTimeout(() => { timer = null; void refresh(); }, intervalMs);
  }
  async function refresh() {
    if (stopped) return store.getState();
    if (documentRef?.visibilityState === 'hidden') { clearTimer(); return store.getState(); }
    if (inFlight) return inFlight;

    clearTimer();
    const requestId = store.beginRead();
    const controller = new AbortController();
    activeController = controller;
    activeRequestId = requestId;
    inFlight = (async () => {
      try {
        const snapshot = await readSnapshot({signal: controller.signal});
        if (!stopped) store.accept(requestId, snapshot, now().toISOString());
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          const status = typeof error?.status === 'string' ? error.status : 'error';
          store.fail(requestId, status, now().toISOString());
        }
      } finally {
        if (stopped) store.cancelRead(requestId);
        inFlight = null;
        activeController = null;
        activeRequestId = null;
        scheduleNext();
      }
      return store.getState();
    })();
    return inFlight;
  }
  function onVisibilityChange() {
    if (documentRef?.visibilityState === 'hidden') { clearTimer(); return; }
    if (started && !inFlight) void refresh();
  }
  function start() {
    if (stopped || started) return;
    started = true;
    documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
    if (documentRef?.visibilityState !== 'hidden') void refresh();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimer();
    activeController?.abort();
    if (activeRequestId !== null) store.cancelRead(activeRequestId);
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
  }

  return Object.freeze({start, stop, refresh, getState: () => store.getState()});
}
