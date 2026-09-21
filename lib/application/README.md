# Application Layer

This layer owns DevClaw use cases.

Application modules coordinate domain decisions, persisted state, and integration
capabilities. They should contain orchestration logic such as queue ticks,
heartbeat passes, task lifecycle operations, worker dispatch, setup flows, and
review handling.

The `issue-runtime` application capability interprets provider label snapshots during explicit
initialization and repair flows, then pass complete runtime records to state
persistence. The state layer never interprets provider projections.

Managed issue creation sagas, archival, retention, confirmed provider deletion, repair, and policy
migration are application use cases. Adapters in `lib/tools` and `lib/cli` must
call these shared operations instead of reproducing lifecycle decisions. Repair
owns snapshot comparison, plan-token validation, issue locking, minimal mutation,
and post-apply integrity verification.

Creation is durable and idempotent: the application verifies provider read-back
before publishing runtime state, and heartbeat resumes safe partial operations.
Ambiguous provider outcomes require manual repair rather than a blind retry.

Terminal pipeline notifications use active issue state as a durable outbox. An
unconfirmed delivery keeps the terminal issue active; heartbeat retries expired
attempt leases and archives the issue only after delivery is confirmed.

## Allowed Dependencies

- `lib/domain/*` for pure workflow and task semantics.
- `lib/state/index.ts` for project, config, setup, and issue runtime persistence APIs.
- `lib/integrations/*` through focused adapter functions or capability types.
- `lib/projection/*` when a use case needs provider-facing label/body projection.

## Boundary Rules

- Do not import OpenClaw tool context types here.
- Do not import CLI command adapters from `lib/cli/commands/*`.
- Do not format OpenClaw tool responses here; keep that in `lib/tools`.
- Do not parse command-line arguments here; keep that in `lib/cli`.
- Heartbeat may initialize missing workspace files but never refresh or overwrite system instructions.
- Explicit setup orchestration owns system-instruction refresh and reset policy.

Use `npm run arch:check:strict` after changing this layer.
