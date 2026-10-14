# Browser Observation adapter — readiness record v0

**Status:** The bounded local M1 read profile is accepted and its implementation is merged. Broader Frontend v1 readiness remains incomplete.
**Owner:** Frontend, with Observation and competent security/operations review.
**Work item:** [Frontend #4](https://github.com/biopeia/frontend/issues/4).
**Canonical design:** [Biopeia frontend v1](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-v1.md), UX and visual specifications, readiness plan, accepted ADR-0113.
**Scope of approval:** local, single-user, same-origin, read-only access to the bounded current view of two approved claim families only. This is not approval for shared or production deployment, history, persistence, remote access, additional claim families, or runtime control.
**Owner dispositions:** [Observation #37](https://github.com/biopeia/observation/issues/37#issuecomment-6176059137), [Docs #167](https://github.com/biopeia/docs/issues/167#issuecomment-6175690251), and [Frontend #4](https://github.com/biopeia/frontend/issues/4#issuecomment-6175690850). These approvals do not substitute for independent review or security/operations evidence.

## 1. Scope and non-authority

Frontend may only present **owner-authorized, explicitly attributable Observation publications** through a separately approved, browser-safe, read-only access boundary. Frontend owns presentation state (selection, camera, filters, display cursor), never World causal state, an Organism's beliefs, Lab evidence, or Observation source semantics. It may not issue commands, use a domain's private checkpoint, infer joins or produce operational observations.

The in-process ObservationPlane `current_messages()` and `open_stream()` contract approved for Lab #332/#40 is **not by itself** a browser-access or security contract. The separately accepted M1 path is an explicit, bounded local bridge and a same-origin Frontend proxy; it is not a general-purpose exposure of the Lab consumer API, and it does not provide durable replay.

## 2. Gates and accountable authorities

| Gate | Required evidence | Authority | Status |
|---|---|---|---|
| Constitutional/frontend ownership | ADR-0113 and approved frontend design package | Architecture Owner | Accepted |
| M1 producer inventory and read contract | Two admitted claim families, bounded-current scope, provenance and exclusions | Observation Owner; World/producer owners for source claims | Accepted for M1 — Observation #37 |
| M1 local security profile | Loopback-only local single-user use, same origin, read only, no export or shared deployment | Project Owner; applicable operations/security review remains distinct | Accepted for M1 — Docs #167 |
| M1 browser transport | Local Observation current-view bridge and same-origin Frontend proxy; bounded GET only | Observation, Frontend and Project Owner | Accepted and implemented — Frontend #4; Observation #45 and Frontend #8 merged |
| Broader screen/family readiness | Catalogs, history, additional claims, geometry and cross-owner coherence | Relevant domain owners | Open — Observation #37; unsupported views remain unavailable |
| Integrity and scientific separation | Independent review of the exact implementation candidate where required by BAW-004 | Relevant domain owners + independent reviewer | Separate review gate; owner approval does not satisfy it |
| Delivery/release | End-to-end CI, accessibility, operational procedures and deployment | Frontend and operations owners | Incomplete; no deployment authorization |

No gate is satisfied merely by the existence of a domain publication or a green build.

## 3. Minimum claim fidelity — owner-authored only

A browser payload must retain or explicitly mark unavailable, *where applicable to its approved family*: issuer-scoped identity, typed subject, semantic family/schema revision, semantic owner authority, producer/asserter, acquisition/epistemic basis, source domain time and revision, units and reference frame, owner checkpoint identity/digest or lineage, asserted World-cut relation, availability, coverage/coherence and delivery provenance. Unsupported fields remain **unknown/unavailable**, not guessed.

Identifiers for `World`, `run`, `World cut`, `owner checkpoint`, `claim` and `Observation delivery` are disjoint. No joins by wall clock, numerical equality, subject name, visual closeness or arrival order. A committed World cut needs World-owned evidence: a publication sequence is never proof of commit.

## 4. State machine the UI must distinguish

| Presentation label | Meaning/constraints |
|---|---|
| Not configured | No approved browser adapter is installed; current v0.1 shell state |
| Loading | A bounded read is in progress; no assertion about source |
| Denied | Access not granted; no claim of source absence |
| Unsupported | No approved contract for this view/family |
| Empty retained materialization | Valid response has no retained matches; not source absence |
| Disconnected / unavailable / error | Transport or read failure; do not silently fall back to old values |
| Stale | Previously displayed publication has exceeded separately approved freshness threshold and is explicitly labeled |
| Gap / rebase | Delivery discontinuity; reset continuity assumptions and require authorized reconciliation |
| Incomplete | Known partial published coverage relative to explicitly supplied source scope |
| Conflict | Same claimed identity, incompatible contents or lineage; withhold coherent global depiction and surface the conflict |
| Unknown | Source has not established the status |

Presentation history/replay is **not** simulation/causal replay. A selected set of distinct owner revisions is not an atomic World state: if accepted, label it “best-available composite” with per-owner revisions.

## 5. Future transport/security design questions (UNDECIDED)

- Which access mode(s) are authorized for local-only development, shared internal use and any external deployment? They require separate scoped dispositions.
- Where are read authorization and credentials enforced, and what are the default-deny scope and session expiry rules?
- How are read budgets, maximum response sizes, pagination, schema/version negotiation, backpressure, gaps and reconnects enforced without implying exactly-once semantics?
- Which publication families can supply genuine geometry/frame/unit claims? Absent that, Spatial Explorer must remain a truthful non-3D unavailable view.
- What minimum source-cut evidence can Frontend verify, and how will conflicting owner revisions appear?
- How are privacy classification, data minimization, caching, logging, deletion requests and incident response handled? The browser must not invent retention authority.

## 6. Negative acceptance cases

A future implementation must demonstrably: reject unexpected schemas and oversized/malformed messages; not execute or render supplied HTML/script as trusted markup; refuse cross-origin/unauthorized reads; withhold source presence inference on empty/denied/disconnected; preserve distinct causal and delivery clocks; clear or qualify stale displayed content after gap/rebase; reject ambiguous cross-domain joins; avoid actual/world-like geometry for absent spatial family; support keyboard/text equivalents at 200% zoom and reduced motion; make no runtime-control requests; avoid storing tokens or claims outside accepted scopes.

Tests require **a precisely pinned, authorized producer+Observation+Frontend integration set**, recorded source evidence, and independent BAW-004 review. Synthetic fixtures may test the UI only when obviously marked as synthetic and never presented as source evidence.

## 7. Implemented M1 boundary and remaining work

The following current revisions contain the merged M1 implementation:

- Frontend `main`: `a16b76ce659d007478b675d7709af67a2116a88f`.
- Observation `main`: `a0d3f61540ba9589edfdb5b3cdd6bf3935afd7d1`.
- World `main`: `5252ebc13f6d73fdb178d0ebc1c9c69735911298`.

The current frontend accepts only `biopeia.observation.current.v1`, and only displays the owner-authorized `embodiment.body_pose@v1` and `environment.finite_scalar_field@1` claims after validating their source identities, authority, provenance, units/frames, and available World-cut lineage. The in-process Observation view is volatile, bounded, and does not guarantee freshness or cross-owner snapshot coherence. The UI must preserve those limitations.

The local path consists of the Observation-owned current-view bridge and a same-origin, GET-only Frontend proxy. The implementation rejects non-loopback Host values, unexpected browser Origin, unsupported methods/routes, and oversized responses; it does not grant access to a shared or external client. The local profile has no end-user authentication mechanism; its trust assumption is single-user access to the development machine and loopback services only.

This merged M1 slice demonstrates local current-view presentation, not completion of the seven-screen product. The following remain unsupported or unproven: World/run catalogs, durable or arbitrary historical queries, general 3D geometry, sensorimotor/action links, additional domain claim families, cross-owner atomic snapshots, remote/shared deployment, persistent authorization, and scientific interpretation. Unsupported views must remain visibly unavailable rather than be populated with synthetic observations.

### Remaining bounded work

1. Complete the automated browser-to-World acceptance path and its exact-candidate independent adversarial review (Frontend #11 / PR #12; the PR is not merged in this record).
2. Review and disposition bounded current-view refresh separately (Frontend #13 / PR #14); polling does not create a history or freshness guarantee.
3. Complete accessibility acceptance, including successful screen-reader and native 200% zoom checks, plus a full rendered contrast review (Frontend #3).
4. Keep the remaining screen/family inventory current under Observation #37. Any new claim family, history, persistence, access mode, or deployment requires its own domain/operational contract and authorization.
5. Do not infer production readiness or deployment permission from merged local code, CI success, or a browser smoke test.
