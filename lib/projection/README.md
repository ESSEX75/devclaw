# Projection Layer

This layer owns the deterministic projection between local issue runtime state
and provider-visible issue data.

Projection modules render and diff managed labels, routing labels, owner/notify
labels, and compact issue body metadata. Local `issues.json` state remains the
source of truth for managed issues; provider labels and metadata are the visible
projection of that state.

## Boundary Rules

- Keep projection helpers deterministic and side-effect free.
- Do not read or write `issues.json` here; use `lib/state/issues`.
- Do not call GitHub, GitLab, or OpenClaw APIs here.
- Do not treat manual provider label edits as authoritative runtime state.
- Do not reintroduce legacy issue/projection facades.

Use `npm run test:issue-state` after changing projection behavior.
