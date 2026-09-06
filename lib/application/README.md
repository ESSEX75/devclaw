# Application Layer

This layer owns DevClaw use cases.

Application modules coordinate domain decisions, persisted state, and integration
capabilities. They should contain orchestration logic such as queue ticks,
heartbeat passes, task lifecycle operations, worker dispatch, setup flows, and
review handling.

Managed issue creation sagas, archival, retention, confirmed provider deletion, repair, and policy
migration are application use cases. Adapters in `lib/tools` and `lib/cli` must
call these shared operations instead of reproducing lifecycle decisions. Repair
owns snapshot comparison, plan-token validation, issue locking, minimal mutation,
and post-apply integrity verification.

Creation is durable and idempotent: the application verifies provider read-back
before publishing runtime state, and heartbeat resumes safe partial operations.
Ambiguous provider outcomes require manual repair rather than a blind retry.

## Allowed Dependencies

- `lib/domain/*` for pure workflow and task semantics.
- `lib/state/*` for project, config, setup, and issue runtime stores.
- `lib/integrations/*` through focused adapter functions or capability types.
- `lib/projection/*` when a use case needs provider-facing label/body projection.

## Boundary Rules

- Do not import OpenClaw tool context types here.
- Do not import CLI command adapters from `lib/cli/commands/*`.
- Do not format OpenClaw tool responses here; keep that in `lib/tools`.
- Do not parse command-line arguments here; keep that in `lib/cli`.

Use `npm run arch:check:strict` after changing this layer.
