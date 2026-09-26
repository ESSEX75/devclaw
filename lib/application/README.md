# Application Layer

This layer owns DevClaw use cases.

## Capability ownership

| Subpackage | Responsibility | Supported entrypoint |
| --- | --- | --- |
| `doctor` | Read-only routing diagnostics and reports. | `doctor/index.ts`: `runRoutingDoctor` |
| `heartbeat` | Periodic service, health passes, and recovery coordination. | `heartbeat/index.ts`: service registration and health operations used by adapters |
| `issue-runtime` | Interpretation of issue projections and complete runtime state writes. | `issue-runtime/index.ts`: resolution and write operations |
| `issues` | Repair, archive, deletion, retention, and policy migration. | `issues/index.ts`: lifecycle commands and repair source |
| `notifications` | Exact endpoint resolution, delivery, and retry of terminal events. | `notifications/index.ts`: delivery and retry operations for sibling use cases |
| `pipeline` | Completion transitions and provider effects. | `pipeline/index.ts`: completion command and rule query for sibling use cases |
| `projects` | Unambiguous project routing and persisted provider selection. | `projects/index.ts`: project/provider context resolution |
| `projection` | Applying deterministic projection diffs to a provider. | `projection/index.ts`: reconcile and apply operations for sibling use cases |
| `queue` | Local-state candidate selection and queue ticks. | `queue/index.ts`: candidate query and project tick for sibling use cases |
| `review` | PR feedback/context and comment acknowledgement. | `review/index.ts`: review context operations for sibling use cases |
| `setup` | Agent setup, route validation, and explicit scope preflight. | `setup/index.ts`: setup and routing operations for adapters |
| `tasks` | Task creation, attachment, status, claim, and edit operations. | `tasks/index.ts`: managed task commands and attachment operations |
| `workers` | Session dispatch and worker completion. | `workers/index.ts`: dispatch and completion commands |

Code outside `lib/application` imports only the supported subpackage entrypoints.
Implementation files within this layer may import sibling implementation files when
the capability is not part of a supported public API. Avoid importing a
subpackage's own entrypoint from that subpackage. Do not create an application
root barrel: each use case has a specific owner.

Use existing narrow external contracts where they already match a consumer:
provider issue reads use the integrations `IssueReader` capability, and
notification delivery uses the application `NotificationRuntime` surface.
Create additional capability types only when a concrete caller needs them;
keep provider error classification and session transport details in integrations.

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
The `issues/repair` capability loads fresh local/provider snapshots, builds a
deterministic plan, validates its token under the issue lock, applies the chosen
source strategy, and verifies the result before clearing integrity errors.

Creation is durable and idempotent: the application verifies provider read-back
before publishing runtime state, and heartbeat resumes safe partial operations.
Ambiguous provider outcomes require manual repair rather than a blind retry.
The `tasks/creation` capability owns the command, operation runner, reconciliation,
durable checkpoint transitions, provider failure mapping, result formatting, and
creation audit. `issue-runtime` builds the complete initial runtime draft used
for projection and persists the authoritative record only after verification.

Terminal pipeline notifications use active issue state as a durable outbox. An
unconfirmed delivery keeps the terminal issue active; heartbeat retries expired
attempt leases and archives the issue only after delivery is confirmed.
Pipeline completion resolves a pure workflow transition plan before provider
effects. Agent completion checks current local and provider state; heartbeat
review, review skip, and test skip recheck local state under the issue lock before
their provider actions. Their shared transition commit applies the provider label,
persists local runtime truth, then reconciles projection. Agent completion releases
the worker before sending completion notifications. Terminal notification
reservation and confirmation occur after the local commit and projection; an
unconfirmed attempt remains eligible for lease-based retry.
The `notifications` capability renders messages without I/O, validates exact
project routes, delivers through runtime or command fallback, and audits typed
outcomes. The `projection` coordinator locks each issue, reads fresh local state,
applies only managed-label changes, verifies provider read-back, and records
integrity without treating provider labels as authoritative state.
The `queue` capability filters and plans pickups from local runtime state, then
rechecks candidates after acquiring each issue lock. The `workers` capability
plans session identity, reserves a concrete slot, submits the turn, and commits
active runtime state. Confirmed delivery rejection releases the slot; uncertain
gateway outcomes retain ownership for inspection without a blind resend.
Unresolved worker delivery is durable in the slot and issue runtime record. Heartbeat
reconciles gateway evidence, avoids automatic worker requeue for these records, and
marks stale uncertainty for operator attention in task status and audit logs.

Heartbeat runs named project passes sequentially and retains findings, planned
actions, applied actions, and errors in its tick report. A failed prerequisite
stops later passes for that project; other projects remain isolated. Health
diagnosis performs reads only, including no audit writes. Explicit remediation
rechecks the slot identity and managed issue state under the issue lock before
calling transition, projection, or delivery operations. Provider lookup failures
are not evidence of issue deletion. Provider-only issues remain diagnostic findings
until an explicit initialization or repair operation creates managed state.

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

Setup validates target, exact route, and configured role/level overrides before effects.
CLI and tools share `runSetup`, including scope preflight. Preview performs no writes
or command calls. Ordinary setup creates missing files and patches only explicit
models; refresh/reset/eject are mutually exclusive standalone operations. Doctor
only reads state. Configuration reset/diff and onboarding selection belong here.
