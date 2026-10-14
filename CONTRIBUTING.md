# Contributing to Biopeia Frontend

Biopeia Frontend is an independent, read-only presentation application. Its purpose and current supported scope are described in [`README.md`](README.md) and the accepted design documents linked there.

## Before changing behavior

1. Start from a ready issue with scope, exclusions, owner, risk, dependencies, and falsifiable acceptance criteria.
2. Check the accepted design/ADR and the exact domain or Observation contract the change consumes. A UI requirement does not authorize a new contract or semantic inference.
3. Keep implementation within the issue. Requests for transport, authentication, persistence/history, operations, or deployment require their own accepted contracts and authorization.

## Pull requests and review

- Submit changes through a pull request to protected `main`; do not use direct pushes or auto-merge.
- Include the linked issue, work class, risk, authority, exact candidate SHA, commands and test results, limitations, and migration/security implications where relevant.
- Resolve all review conversations and satisfy the required checks on the exact candidate before merge.
- Obtain independent review when required by the canonical [risk-proportional review policy](https://github.com/biopeia/.github-private/blob/main/workflow/review-policy.md). CI is not a substitute for independent review, and independent review is not an owner decision.
- Do not deploy or claim runtime availability merely because a pull request is merged.

## Local checks

With Node.js 22 or newer and npm available, run:

```sh
npm run check
git diff --check
```

`npm run check` runs the repository's tests and static build. Record the exact candidate revision and output summary in the pull request; do not weaken a check to make it pass.
