# Frontend V2 — Observatory implementation contract (working branch)

Status: IMPLEMENTATION IN PROGRESS — NOT APPROVED. This document does not grant authority or imply that features exist.

## Target

Evolve the existing seven-screen passive frontend into a scientific observatory with three explicitly separated read-only experiences: Live, Replay and Research. Preserve the existing M1 path and contracts without creating a legacy compatibility layer. New capability is enabled only when the source has an approved contract and real evidence.

## Architectural boundaries

- World owns causal commits; no UI-created causal state.
- Domain owners own semantics; Observation transports and archives, without cross-domain causal inference.
- Lab owns scientific evidence admission; frontend never promotes exploratory evidence to validated claims.
- Organism cognition must not be inferred from weight changes or rendered movement.
- No experiment execution, authentication, remote exposure, or cross-domain joins without separately approved contracts.
- Follow ADR-0113, ADR-0078, ADR-0099, ADR-0100 and UC-0001; require BAW-004 independent review before merge.

## Delivery slices and acceptance gates

1. **Live**: preserve existing current-view transport; render spatial claims by their exact family/version; explicit freshness, missing-data and discontinuity states; browser regression and accessibility checks.
2. **Replay**: read-only local archive adapter ONLY after approved browser-read contract; paginated reads with bounded limits, explicit capture-session identity, delivery sequence separate from causal tick, and visible gaps. Do not infer complete World history from Observation delivery order.
3. **Organism inspector**: display only authorized owner-provided signals with units, timestamp, lineage, provenance and limitations; no inferred emotions, objectives or learning.
4. **Research**: render Lab-custodied protocol IDs, source revisions, evidence digests, deviations, and scientific admission status. No write operations or automatic promotion.
5. **Experiment preparation**: design only, behind an explicit unavailable state until Lab defines authenticated and authorized requests. Do not expose execute controls.

## Release gates

- Unit and contract tests for each new adapter, malformed payload, duplicates, stale data, gaps and unknown schema versions.
- Real-browser keyboard, responsive, contrast and reduced-motion tests.
- Pinned source revisions and reproducible end-to-end evidence for each supported feature.
- CI green on the exact PR HEAD; independent BAW-004 review and competent owner disposition. Do not merge automatically.

## Explicitly out of scope for this branch until approved

Distributed archive recovery, full causal replay, arbitrary remote browser access, organism mind-reading, intervention execution and scientific acceptance.
