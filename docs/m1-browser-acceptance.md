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

## Live multi-cycle acceptance (Frontend #16)

`npm run acceptance:m1:live` is the live-session acceptance path. Unlike the historical one-cycle harness above, it launches the merged World `world-m1` process from an explicit operator profile with `--cycles 20`, waits for its actual `ready` event, and opens one real Chrome page against the process's loopback Observation bridge. That page remains attached while it refreshes the fixed current-view route. The runner correlates the World JSONL `cycle_committed` events with two distinct World ticks and source-lineage digests actually rendered in the browser, and requires at least two of those commits to occur after browser attachment and then appear in a subsequent browser read.

The browser check retains the approved family allowlist, provenance/context display, GET-only same-origin reads, foreign-Origin denial, console-error/warning checks and a captured screenshot digest. It also runs the existing separate real-browser unavailable-state check against an explicitly refused loopback endpoint; that tests truthful unavailability and does not infer source absence. World is the authority for committed cut identity; Frontend observes claim context and lineage without creating a cross-owner causal join.

### Reproduction

Use clean Frontend and World worktrees, an existing local clone for each pinned dependency, Node.js 22+, Python from the World runtime environment and a local Chrome binary. `WORLD_M1_BIN` must be the executable installed from the exact World checkout in `WORLD_REPO`. `WORLD_PROFILE` must be the explicit M1 profile inside that checkout, and every dependency pin is checked both against World's `pyproject.toml` and the process JSONL `source_revisions` before the report can pass.

```sh
WORLD_REPO=/path/to/clean/world-worktree \
WORLD_SHA="$(git -C /path/to/clean/world-worktree rev-parse HEAD)" \
WORLD_M1_BIN=/path/to/clean/world-worktree/.venv/bin/world-m1 \
WORLD_PROFILE=/path/to/clean/world-worktree/profiles/m1/scalar-sensorimotor-mujoco-3.15-v1.json \
WORLD_PYTHON=/path/to/clean/world-worktree/.venv/bin/python \
ORGANISM_REPO=/path/to/organism-clone \
EMBODIMENT_REPO=/path/to/embodiment-clone \
ENVIRONMENT_REPO=/path/to/environment-clone \
MODALITY_REPO=/path/to/modality-clone \
OBSERVATION_REPO=/path/to/observation-clone \
OBSERVATION_SHA=a0d3f61540ba9589edfdb5b3cdd6bf3935afd7d1 \
CHROME_BIN=/usr/bin/google-chrome \
npm run acceptance:m1:live
```

The corresponding machine-readable stdout record is `M1_LIVE_ACCEPTANCE_RESULT=...`. It includes exact Frontend and World SHAs, the World process's actually verified Organism, Embodiment, Environment, Modality and Observation revisions, profile digest, each actual World commit/tick, ticks observed after browser attachment, browser version, same-origin read requests, screenshot SHA-256 and bounded limitations. The World lock revision supplied to each run is authoritative; do not substitute Observation `main` unless the World lock and executable are intentionally advanced and revalidated.

This is a twenty-cycle local smoke acceptance only. It demonstrates no tolerance, safety or performance guarantee at 24 or more cycles; no history, remote/public service, scientific efficacy, restore/continuity, or atomic cross-owner snapshot.

### Optional live local-archive browser leg

Set `FRONTEND_ARCHIVE_ACCEPTANCE=1` on the normal `npm run acceptance:m1:live` invocation to enable the opt-in local archive leg. In this mode the runner starts the same real World M1 process with its explicit `--archive-observations` option, waits for that capture to close, starts the Observation-owned loopback read adapter against the resulting SQLite archive, and then releases the already-open browser to read it. The browser requires a non-empty capture catalog and receipt page; it selects a capture, checks bounded coverage wording, applies owner/family/revision filters, exercises the next-page cursor when present, and verifies archive reads remain same-origin GETs. No archive entries are synthesized.

The archive is created by the real run, but this does not make receipt sequence causal time or assert a World-run join: the capture and browser expose separate identities and no such association is rendered. This candidate acceptance still does not establish causal replay, complete World history, exact archive wire-contract approval, independent review, or V2 release acceptance. The archive adapter starts only after capture has closed so the read path does not contend with its SQLite writer.
