# Browser Observation adapter — readiness contract v0

**Lifecycle:** PROPOSED, not ratified. **Owner:** Frontend, with Observation and competent security/operations review.  
**Work item:** [Frontend #4](https://github.com/biopeia/frontend/issues/4).  
**Canonical design:** [Biopeia frontend v1](https://github.com/biopeia/docs/blob/main/technical/design/frontend/biopeia-frontend-v1.md), UX and visual specifications, readiness plan, accepted ADR-0113.  
**Implementation authorization:** NOT GRANTED. This document is a boundary/readiness specification, not an API design approval, deployment plan or adapter implementation.

## 1. Scope and non-authority

Frontend may only present **owner-authorized, explicitly attributable Observation publications** through a separately approved, browser-safe, read-only access boundary. Frontend owns presentation state (selection, camera, filters, display cursor), never World causal state, an Organism's beliefs, Lab evidence, or Observation source semantics. It may not issue commands, use a domain's private checkpoint, infer joins or produce operational observations.

The existing in-process ObservationPlane `current_messages()` and `open_stream()` contract approved for Lab #332/#40 is **not** a browser-access or security contract. Do not expose that in-process plane over HTTP or WebSockets by convenience, or assume durable replay.

## 2. Gates and accountable authorities

| Gate | Required evidence | Authority | Status |
|---|---|---|---|
| Constitutional/frontend ownership | ADR-0113 and approved frontend design package | Architecture Owner | Accepted |
| Current producer inventory and read API | Exact SHA, admitted families, claim semantics, access/query/replay limits, World-cut provenance | Observation Owner; World/producer owners for source claims | Open — Observation #37 |
| Access and security profile | Deployment setting, authenticated principals, read scopes, origin/CORS/CSP, privacy, cache/retention, logging, incident handling, threat model | Competent security/operations owner | Open — Docs #167 |
| Network/browser transport | Explicit response/query/stream API with bounds, pagination, validation, backpressure and stale semantics | Observation Owner, security/operations and Frontend consumer | Not proposed as an implementation |
| Integrity and scientific separation | Independent adversarial review of the exact accepted contract and actual implementation slice | Relevant domain owners + BAW-004 | Open |
| Delivery/release | Exact-SHA CI, fail-closed E2E negatives, accessible fallback, rollback/runbook | Frontend and operations owners | Blocked |

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

## 7. Proposed next bounded work

1. Observation #37: domain owner publishes the exact family/access inventory and a concrete *read-only browser-consumer* contract decision.
2. Docs #167: competent security/operations owner selects threat/deployment profile, including local development scope.
3. Frontend #4: owner reviews this contract inventory and removes unsupported feature slices.
4. Only after the gates, open a separate implementation issue/PR to add a transport adapter. Do not retrofit Lab's in-process surface.
