const EMPTY_SOURCE = Object.freeze({
  status: 'not-configured',
  claims: [],
  scope: null,
  freshness: null,
  coherence: null,
  error: null,
});

export const SNAPSHOT_REFRESH_INTERVAL_MS = 1000;

export function createSnapshotRefresh({
  readSnapshot,
  onState,
  documentRef = globalThis.document,
  scheduler = globalThis,
  intervalMs = SNAPSHOT_REFRESH_INTERVAL_MS,
  now = () => new Date(),
}) {
  if (typeof readSnapshot !== 'function' || typeof onState !== 'function') {
    throw new TypeError('Snapshot refresh requires readSnapshot and onState functions');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < SNAPSHOT_REFRESH_INTERVAL_MS) {
    throw new RangeError(`Snapshot refresh interval must be at least ${SNAPSHOT_REFRESH_INTERVAL_MS} ms`);
  }

  let current = EMPTY_SOURCE;
  let timer = null;
  let inFlight = null;
  let started = false;
  let stopped = false;

  function publish(next) {
    current = next;
    onState(current);
  }

  function clearTimer() {
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext() {
    clearTimer();
    if (stopped || !started || documentRef?.visibilityState === 'hidden') return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      void refresh();
    }, intervalMs);
  }

  async function refresh() {
    if (stopped) return current;
    if (documentRef?.visibilityState === 'hidden') {
      clearTimer();
      return current;
    }
    if (inFlight) return inFlight;

    clearTimer();
    const lastCheckedAt = current.lastCheckedAt ?? null;
    publish({...EMPTY_SOURCE, status: 'loading', lastCheckedAt});
    inFlight = (async () => {
      try {
        const snapshot = await readSnapshot();
        publish({...snapshot, lastCheckedAt: now().toISOString()});
      } catch (error) {
        const status = typeof error?.status === 'string' ? error.status : 'error';
        publish({...EMPTY_SOURCE, status, lastCheckedAt: now().toISOString()});
      } finally {
        inFlight = null;
        scheduleNext();
      }
      return current;
    })();
    return inFlight;
  }

  function onVisibilityChange() {
    if (documentRef?.visibilityState === 'hidden') {
      clearTimer();
      return;
    }
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
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
  }

  return Object.freeze({
    start,
    stop,
    refresh,
    getState: () => current,
  });
}
