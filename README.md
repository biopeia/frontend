# Biopeia Frontend

Independent, passive, read-only human-facing Biopeia presentation application. **M1 local read integration candidate** — it can consume only a bounded current Observation view through a same-origin local proxy when the accepted Observation bridge is available. It does not provide history, persistence, World controls, authentication, or experiment operations.

## Architecture source

- [Approved architecture](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-v1.md)
- [Approved UX (seven peer screens)](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-ux-spec-v1.md)
- [Visual design](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-visual-design-v1.md)
- [Readiness gates](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-approval-and-development-readiness-v1.md)
- ADR-0113, ADR-0078, ADR-0100, ADR-0099 and UC-0001 remain controlling.

## Start the bounded local read

Requires Node.js 22 and npm. No npm dependencies or external credentials are required.

1. Run the Observation local read bridge inside the same runtime process that owns the existing `ObservationPlane`. The frontend cannot create that publication plane and cannot read World or owner state directly. The bridge is a proposed, separate Observation change; it must be available and accepted before this frontend candidate can be called an end-to-end integration.
2. Start this app with `npm run dev`. It binds only to `127.0.0.1:4173`, builds the static bundle, and proxies a single same-origin `GET /api/observation/current` to `http://127.0.0.1:4174/v1/current`.
3. If the bridge uses a different explicit loopback port or frontend port, set `OBSERVATION_BRIDGE_URL` and `PORT` respectively and configure the bridge's exact allowed Origin to match `http://127.0.0.1:<PORT>`. The bridge URL must remain an explicit `http://127.0.0.1:<port>/v1/current` URL.

The frontend performs one current-view read at startup and only reads again when the user selects **Refresh read**. It does not poll or cache. The proxy enforces loopback binding, exact Host and same-origin request checks, GET-only access, no query/body, a 1 MB response cap and no-store responses. This is a local development boundary, not an authentication or multi-user security solution. See [M1 browser acceptance](docs/m1-browser-acceptance.md) for the reproducible real-browser path and its limitations.

## Scope v0.1

Seven peer-level routes: Worlds & Runs; World Overview; Spatial Explorer; Causal Timeline; Sensorimotor Trace; Claim Inspector; Connection & Access. English, both accessible light/dark themes, responsive layout, keyboard controls and reduced-motion support. Context, availability and unconnected states are textual, never filled with invented source values.

The browser client accepts only schema `biopeia.observation.current.v1` and the exact M1 contracts `embodiment.body_pose@v1` and `biopeia.environment.finite-scalar-field@1`. It validates required identities, units, frames, World context, owner lineage and the contract's bounded/volatile scope; unsupported claim families are withheld. Claims remain separate: no shared World snapshot, causal relationship, World/run catalog, historical timeline, scene geometry, organism activity or source absence is inferred. Local delivery sequence is not causal time.

Observation PR #45, which supplies the local read bridge, is merged. A bounded automated Chrome run now exercises a real World production cycle, the resulting owner publications, the same-origin proxy, and the browser. The reproducible evidence is source-pinned in `docs/m1-browser-acceptance.md`. World’s dependency lock still awaits its separately reviewed update in World PR #146; the acceptance job explicitly overlays the pinned Observation source tree and does not claim that normal package installation already resolves that revision. This candidate is not a deployed or generally operational service.

## Governance

This candidate changes cross-domain browser access and is HIGH risk. It requires an independent adversarial review of the exact PR candidate under BAW-004 before merge. The bounded source-read scope and local-only profile are recorded in Observation #37 and Docs #167. Do not describe M1 as deployed or generally operational until the exact World–Observation–Frontend composition is accepted. No automatic production deployment, no legacy compatibility shim and no implication that M1 supports scientific evidence admission.

Repository-specific contributor and agent instructions are in [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). The canonical agent work contract and review policy remain maintained in the private [`biopeia/.github-private`](https://github.com/biopeia/.github-private/tree/main/workflow) repository; this repository does not duplicate or override them.
