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

## Dependencies and boundaries

- Coordinate domain decisions, state persistence, and integration capabilities.
- Use `lib/state/index.ts` for storage and focused integration APIs for provider
  and session operations. Pure provider projection belongs to `lib/projection`.
- Reuse narrow contracts such as `IssueReader` and `NotificationRuntime` when they
  fit the caller; introduce a new capability type only for a concrete consumer.
- Do not import tool context types or CLI adapters, parse CLI arguments, or format
  OpenClaw tool responses here.
- Managed runtime state is authoritative. Provider labels are imported only by
  explicit initialization or repair. State never interprets provider projections.
- Tools and CLI call shared application commands rather than reproduce lifecycle
  decisions. Use `npm run arch:check:strict` after changing layer boundaries.

## Detailed contracts

Keep operation-specific guarantees with their owning capability:

- [Issue runtime](issue-runtime/README.md): initialization, update semantics, and
  interpretation of provider observations.
- [Issue administration](issues/README.md): archival, retention, and deletion;
  [repair](issues/repair/README.md): snapshot-bound plans and verified application.
- [Tasks](tasks/README.md): lifecycle and attachment orchestration;
  [creation](tasks/creation/README.md): durable provider creation and recovery.
- [Setup](setup/README.md): ownership discovery, permissions, approvals, and routes.
- [Workers](workers/README.md): slot ownership, delivery uncertainty, and explicit
  operator recovery.

These documents own the detailed contracts; this README does not repeat them.
A subdirectory does not need a README merely because it has an `index.ts`.

## Doctor

Doctor reads configuration, ownership, routes, and archive counters without writes,
commands, initialization, or repair. Setup owns exact-route validation and tool
policy; doctor owns diagnostic severity. A failed project inspection produces an
error finding and no fabricated counter row; healthy projects retain their results.
Root configuration or registry failures reject inspection. `routing.ok` covers
route/tool checks only; archive errors can still fail the overall report. Retention
ordering findings do not promise cleanup. Ownership discovery spans SDK-resolved
workspaces; corrupt registries cannot establish tool isolation.

## Queue

Candidates come from healthy, unowned local queued state in stable issue order.
Provider reads supply message context, never authoritative workflow selection.
Creation readiness, issue eligibility, and project slots are rechecked after taking
an issue lock. Workers own the atomic slot reservation and delivery; queue does not
send session messages or persist ownership. Dry-run returns a candidate/slot plan
without effects.

## Projection

Application projection locks the issue, reads fresh local/provider snapshots, calls
pure diff logic, mutates managed labels, verifies read-back, and records integrity
and audit. Unmanaged labels are preserved. Provider mutation or read-back failures
add a label-owned diagnostic identified by the coordinator's reserved prefix.
Verified labels clear only that diagnostic group. Metadata, unrelated failures,
and non-OK states without known diagnostic ownership remain blocked. Results expose
label changes separately from overall local integrity. Propagated audit errors are
reported independently and never reclassify verified labels as failed; the general
audit logger is best-effort, so absence of an audit error is not a durable receipt.
Callers holding the issue lock use `reconcileManagedLabelsLocked` to avoid nesting.

Heartbeat checks provider identity and metadata under that same issue lock before
label reconciliation. It clears only its verified metadata/fetch/missing-provider
diagnostics and retains independent failures. Explicit repair remains the operation
that verifies the full supported projection contract and resolves stale repair
errors. These rules use existing diagnostic strings, without a new storage schema.

## Pipeline and notifications

Pipeline resolves a pure transition plan before effects. Completion, review, and
skip paths recheck state under the issue lock, apply provider workflow labels,
persist local truth, then reconcile projection. Completion releases the worker
before notifications. Notification routes use the exact stored project binding;
unknown bindings or invalid routes never redirect delivery. Rendering has no I/O.
A successful runtime send never invokes command fallback; audit records outcomes.

Terminal issue state is a durable notification outbox. Reservation and confirmation
follow the local commit and projection. Unconfirmed delivery keeps the issue active;
heartbeat retries expired state-owned attempt leases and archives only after
confirmation.

## Heartbeat

Project passes run sequentially and retain findings, plans, applied actions, and
errors. A failed prerequisite stops subsequent passes for that project; others
remain isolated. Diagnosis performs reads only, including no audit writes.
Remediation rechecks slot identity and managed state under the issue lock.
Provider lookup failures never prove deletion. Provider-only issues remain
observations until explicit initialization or repair. Heartbeat may create missing
workspace files, but explicit setup owns instruction refresh and reset.
