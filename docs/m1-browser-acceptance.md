# M1 World–Observation–Frontend Browser Acceptance

This documented acceptance job exercises one bounded real TARGET path:

```text
World production causal composition
  → committed owner projections in Observation
  → approved loopback current-view bridge
  → same-origin Frontend proxy
  → real Chrome browser rendering
```

It is an acceptance run, not a unit-test fixture for the cross-domain joins. The existing World integration composition constructs the domain-owned state and executes the causal step. The harness starts the approved read bridge over the resulting in-memory `ObservationPlane`; it does not synthesize claims or inject intermediate payloads.

## Revisions exercised

The initial reproduced source set is:

| Repository | Revision | Role |
|---|---|---|
| `biopeia/world` | `5252ebc13f6d73fdb178d0ebc1c9c69735911298` | Existing World production composition and integration scenario |
| `biopeia/observation` | `a0d3f61540ba9589edfdb5b3cdd6bf3935afd7d1` | Current-view read bridge and Observation contracts |
| `biopeia/frontend` | The exact checkout `HEAD` printed by the runner | Browser consumer and same-origin proxy |

World's current dependency lock has not yet been updated to the Observation revision above. Accordingly, the runner explicitly adds the pinned Observation `src/` tree to Python's import path and verifies both source checkout SHAs before it starts. This proves the source-level composition stated above; it does **not** claim that the normal World package lock already resolves to that Observation revision. World PR #146 tracks that lock update and remains subject to its own review gate.

## Prerequisites

- Node.js 22 or newer and npm.
- Python environment used by the pinned World checkout, with dependencies needed by its existing integration test installed (including MuJoCo).
- A local Chrome/Chromium executable. The runner uses Chrome DevTools Protocol through Node's built-in WebSocket; it adds no browser automation package dependency.
- Clean or otherwise intentionally pinned checkouts at the exact World and Observation revisions in the table. The runner checks their current `HEAD`; it does not fetch, checkout, reset, or clean repositories.

## Reproduction

From the Frontend repository root, set the paths for the exact checkouts and run:

```sh
WORLD_REPO=/path/to/world \
WORLD_SHA=5252ebc13f6d73fdb178d0ebc1c9c69735911298 \
OBSERVATION_REPO=/path/to/observation-a0d3f615 \
OBSERVATION_SHA=a0d3f61540ba9589edfdb5b3cdd6bf3935afd7d1 \
WORLD_PYTHON=/path/to/world/.venv/bin/python \
CHROME_BIN=/usr/bin/google-chrome \
npm run acceptance:m1
```

The run fails visibly if an input is missing, either dependency SHA differs, the World production composition or Observation bridge is unavailable, the foreign origin is accepted, Chrome does not launch, an unsupported network request occurs, or a browser assertion fails. There is no skip or synthetic fallback.

## Assertions

The automated browser run verifies:

- The browser receives only two approved claim families: `embodiment.body_pose` and `environment.finite_scalar_field`.
- The displayed claims retain their contract, owner identities, subject identities and source-lineage content, while the UI explicitly avoids claiming a shared cross-owner snapshot or semantic join.
- Both reads use the fixed same-origin `GET /api/observation/current` route; the browser makes no non-same-origin request.
- A foreign `Origin` is rejected by the Observation bridge.
- Repeated reads leave the committed World tick, World manifest and retained Observation messages unchanged.
- After the bridge becomes unavailable, a second real browser session presents an unavailable diagnostic, renders no stale claims, and does not describe the failure as source-state absence.

## Output and limits

The runner emits a machine-readable `M1_ACCEPTANCE_RESULT` record with the exact source SHAs, World identity/tick/commit, Observation delivery sequences, browser version, request list and outcome. Record that output in the linked Frontend issue or PR for each exact candidate run; a run from an uncommitted or dirty checkout is not candidate evidence.

This acceptance job covers one bounded, local, single-process current-view run. It does not demonstrate remote access, durable history, deployment, persistence across restart, atomic cross-owner snapshots, scientific efficacy, or normal resolution through the World package lock. Any source revision change requires rerunning the job and recording the new exact revisions and result.
