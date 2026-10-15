// Coalesces UI work to the latest selected state. Skipped values are never a history.
export function createPresentationScheduler(callback, {
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? (fn => globalThis.setTimeout(fn, 0)),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? globalThis.clearTimeout?.bind(globalThis),
  report = count => console.info(`Observation presentation coalesced ${count} intermediate UI update(s)`),
} = {}) {
  let frame = null;
  let latestArgs = null;
  let skipped = 0;
  let stopped = false;
  return Object.freeze({
    schedule(...args) {
      if (stopped) return;
      if (latestArgs !== null) skipped += 1;
      latestArgs = args;
      if (frame === null) frame = requestFrame(() => {
        frame = null;
        const current = latestArgs;
        const omitted = skipped;
        latestArgs = null;
        skipped = 0;
        if (omitted) report(omitted);
        callback(...current);
      });
    },
    stop() {
      stopped = true;
      if (frame !== null) cancelFrame?.(frame);
      frame = null;
      latestArgs = null;
      skipped = 0;
    },
  });
}
