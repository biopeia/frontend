// Keep the renderer lifecycle independent from Observation acquisition. While
// an async mount is pending, retain only the newest authorized presentation
// input and reconcile it once the renderer exists.
export function createSpatialRenderController({mount, isConnected = container => container.isConnected} = {}) {
  if (typeof mount !== 'function') throw new TypeError('mount must be a function');
  const states = new WeakMap();

  function reconcile(container, input) {
    const signature = JSON.stringify([input.environment, input.embodiment]);
    const poseSignature = JSON.stringify(input.renderPose);
    const provenanceSignature = JSON.stringify([input.environmentClaim, input.embodimentClaim]);
    let state = states.get(container);
    if (!state) {
      state = {desired: null, signature: null, poseSignature: null, provenanceSignature: null, stale: null, renderer: null, pending: false};
      states.set(container, state);
    }
    state.desired = {input, signature, poseSignature, provenanceSignature};
    if (state.pending) return;

    if (state.renderer && state.signature !== signature) {
      state.renderer.dispose?.();
      state.renderer = null;
      state.signature = null;
      state.poseSignature = null;
      state.provenanceSignature = null;
    }
    if (!state.renderer) {
      state.pending = true;
      const requested = state.desired;
      mount(container, requested.input).then(renderer => {
        state.pending = false;
        if (!isConnected(container)) {
          renderer.dispose?.();
          states.delete(container);
          return;
        }
        state.renderer = renderer;
        state.signature = requested.signature;
        state.poseSignature = requested.poseSignature;
        state.provenanceSignature = requested.provenanceSignature;
        state.stale = requested.input.stale;
        // A newer owner descriptor requires a new mount; otherwise update only
        // the dynamic pose/status, preserving static geometry and camera.
        if (state.desired.signature !== state.signature) {
          renderer.dispose?.();
          state.renderer = null;
          state.signature = null;
          reconcile(container, state.desired.input);
          return;
        }
        applyLatest(state);
      }).catch(() => {
        state.pending = false;
        if (!isConnected(container)) {
          states.delete(container);
          return;
        }
        // Ignore a failure for an obsolete request; attempt the newest one.
        if (state.desired.signature !== requested.signature) {
          reconcile(container, state.desired.input);
          return;
        }
        container.textContent = 'Spatial descriptor validation failed; no geometry rendered.';
      });
      return;
    }
    applyLatest(state);
  }

  function applyLatest(state) {
    const {input, poseSignature} = state.desired;
    if (state.poseSignature !== poseSignature || state.stale !== input.stale) {
      state.renderer.updatePose(input.renderPose, input.stale || (!input.renderPose && input.status === 'available'));
      state.poseSignature = poseSignature;
      state.stale = input.stale;
    }
    if (state.provenanceSignature !== state.desired.provenanceSignature) {
      state.renderer.updateProvenance?.(input.environmentClaim, input.embodimentClaim);
      state.provenanceSignature = state.desired.provenanceSignature;
    }
  }

  return {reconcile};
}
