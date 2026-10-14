# Biopeia Frontend

Independent, passive, read-only human-facing Biopeia presentation application. **Bootstrap / disconnected shell** — it does not access live Observation or World data, invent test claims, authenticate users, or control Organism, experiments or simulation.

## Architecture source

- [Approved architecture](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-v1.md)
- [Approved UX (seven peer screens)](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-ux-spec-v1.md)
- [Visual design](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-visual-design-v1.md)
- [Readiness gates](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-approval-and-development-readiness-v1.md)
- ADR-0113, ADR-0078, ADR-0100, ADR-0099 and UC-0001 remain controlling.

## Start locally

Requires Node.js 22 and npm. `npm run build`, `npm run dev`, `npm test` (no npm dependencies or package installation required). No backend, external credentials or paid services.

## Scope v0.1

Seven peer-level routes: Worlds & Runs; World Overview; Spatial Explorer; Causal Timeline; Sensorimotor Trace; Claim Inspector; Connection & Access. English, both accessible light/dark themes, responsive layout, keyboard controls and reduced-motion support. Context, availability and unconnected states are textual, never filled with invented source values.

`src/model.js` isolates view routes and a fail-closed, read-only availability model. **There is no live adapter**. A later approved feature contract must specify browser-safe Observation access, authentication/scope, transport, fields, provenance, World-cut evidence, loss/rebase and caching before implementation. Do not wire the current in-process ObservationPlane directly to a browser.

## Governance

Class ORDINARY (bootstrap); risk MEDIUM for cross-domain presentation and future integration. Independent BAW-004 review and relevant owners required before merge. No automatic merge or production deployment. No legacy or compatibility shim.

Repository-specific contributor and agent instructions are in [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). The canonical agent work contract and review policy remain maintained in the private [`biopeia/.github-private`](https://github.com/biopeia/.github-private/tree/main/workflow) repository; this repository does not duplicate or override them.
