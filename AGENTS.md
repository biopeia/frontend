# Agent instructions for Biopeia Frontend

This file contains repository-specific boundaries only. The canonical Biopeia agent contract and review policy are maintained in [`biopeia/.github-private/workflow`](https://github.com/biopeia/.github-private/tree/main/workflow), especially:

- [`agent-work-contract-v1.md`](https://github.com/biopeia/.github-private/blob/main/workflow/agent-work-contract-v1.md)
- [`review-policy.md`](https://github.com/biopeia/.github-private/blob/main/workflow/review-policy.md)
- [`project-1-governance.md`](https://github.com/biopeia/.github-private/blob/main/workflow/project-1-governance.md)

Follow those documents for issue readiness, work class and risk, evidence, review, handoff, and closure. This repository file does not replace them.

## Frontend-specific boundaries

- Read the applicable accepted design and ADR documents linked from `README.md` before changing architecture, screen behavior, data interpretation, or security boundaries.
- Frontend is a presentation consumer, not an owner of domain state, causal transitions, scientific protocols, or evidence admission.
- Do not fabricate source claims, infer source absence from an empty/unavailable response, infer causality from arrival order, or present a visual association as a causal relation.
- Do not add browser access, a transport, authentication, persistence, historical queries, runtime controls, or deployment unless a ready issue identifies the accepted contract and explicit implementation authorization.
- Keep every read bounded and read-only; preserve the source authority, identity, revision, time context, and provenance that the accepted contract exposes.
- Do not introduce legacy compatibility paths or mutate domain-owned state.

## Change and verification workflow

- Work from an issue on a task branch and submit a pull request to `main`; do not push ordinary changes directly to `main` or enable auto-merge.
- Follow [`CONTRIBUTING.md`](CONTRIBUTING.md) for local verification and evidence recording.
- Report exact base/candidate SHAs and commands/results. Distinguish CI, owner disposition, independent review, merge, and deployment; none implies another.
- Apply the risk-proportional independent review thresholds in the canonical policy. Do not self-approve or describe the executor's own review as independent.
