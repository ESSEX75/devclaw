# Worker Dispatch

This capability plans and executes one worker assignment. `plan.ts` computes the configured model, deterministic session key, and reuse/reset decision without I/O. `dispatch-task.ts` owns the issue lock, fresh safety checks, provider transition, and command order. `dispatch-context.ts` loads comments, PR evidence, attachments and role instructions before reservation. Gateway cleanup lives in the integration adapter. `session-delivery.ts` observes a brief gateway acceptance window using the narrow OpenClaw submission capability. `state.ts` reserves and releases the project slot and commits issue runtime state before provider projection reconciliation. `reconcile-delivery.ts` inspects slot, issue, and gateway session evidence after an uncertain response; it never retries or rolls back on absence alone. `audit.ts` records completed dispatch metadata.

A confirmed local submission failure restores the provider label and releases the reservation. A nonzero gateway command exit, timeout, lost response, or still-pending command retains the reservation and active runtime ownership so another tick cannot send the issue again. The slot receives a durable `submitting` marker before the gateway call. An unresolved response is stored on both slot and issue; explicit command success clears both markers. Heartbeat checks gateway evidence and raises `needs_attention` after five minutes without recent worker activity. Session existence alone never proves that the task arrived. The task status projection exposes the evidence and an investigation hint. An operator must confirm the run outcome before manually changing state or dispatching again. Custom roles and levels come from resolved configuration. `finish-work.ts` remains the separate worker completion command.

An operator can preview `devclaw worker-delivery` with `--dry-run` and apply the same verified decision with `--apply`. The command requires project slug, issue ID, exact session key, `--delivery-id` from task status, `--reason`, and `--decision confirmed-started` or `--decision confirmed-not-started`. `confirmed-started` clears the uncertainty while retaining the active worker. `confirmed-not-started` validates the previous role queue, restores the provider label, releases the exact slot, and returns local issue state to that queue. Before choosing non-start, the operator must verify that no accepted or in-flight turn can still run. Initial decisions require the issue and slot to own the supplied session and delivery operation ID. The intent and operator evidence are written before effects; repeating the same request resumes it after provider or local-write interruption. A different decision cannot overwrite that evidence. Pending resolution blocks dispatch, completion, deletion and archival until all effects settle. Completed decisions are idempotent.

Comment reactions begin only after confirmed gateway acceptance and the local
state commit attempt. Pending turns defer acknowledgement until acceptance;
rejected or unknown turns leave comments unacknowledged. Only issue comments
included under the task context limit and the supplied PR feedback are marked.
Conflict-only messages omit issue comments, so those comments remain unmarked.
Initial reactions run independently of the dispatch result; late callbacks acquire the issue lock and compare their submission token with fresh state and any operator resolution. A callback from an older turn never clears a reused session's marker or acknowledges its comments. Reactions are
best-effort: a process interruption can leave accepted context unmarked, and an
operator resolving uncertainty does not replay acknowledgement. They do not prove
that the worker read or acted on the comment.

Dispatch also rejects a committed pipeline transition whose previous worker slot
is still awaiting release. Pipeline recovery owns that release intent.


Finish-work resolves exactly one configured slot; a supplied session must match it,
and an ambiguous sessionless request is rejected. The pipeline rechecks that exact
slot run under the issue lock. Developer completion requires a current open PR;
authorization/transient read errors propagate, and current merge conflicts block
completion. Truncated cross-project audit history is no longer a decision source.

Dispatch supplies resolved capacity and execution mode to the atomic project-slot
reservation before provider or gateway effects. Existing issue policy snapshots,
including null, survive dispatch unchanged; configuration defaults initialize only
previously unmanaged runtime records.
