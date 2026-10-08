# Application

Owns use cases coordinating domain decisions, state persistence, and integrations.
Adapters outside this layer use the root `index.ts`. Within application, use sibling
capability entrypoints; never import the root or a capability's own barrel internally.

| Capability | Ownership |
| --- | --- |
| `doctor` | Read-only routing diagnostics. |
| `heartbeat` | Periodic maintenance, health, recovery, and pickup scheduling. |
| `issue-runtime` | Runtime resolution, initialization, and complete state writes. |
| `issues` | Archive, deletion, retention, policy migration, and repair. |
| `notifications` | Exact endpoint delivery, terminal retries, and delivery audit. |
| `pipeline` | Completion transitions and provider effects. |
| `projects` | Project routing and persisted provider selection. |
| `projection` | Applying deterministic provider projection changes. |
| `queue` | Local candidate selection and queue ticks. |
| `review` | PR feedback/context and comment acknowledgement. |
| `setup` | Agent configuration, permissions, and route validation. |
| `tasks` | Managed task commands, attachments, and worker context. |
| `workers` | Dispatch, completion, and uncertain-delivery recovery. |

Each capability exposes its supported API through `index.ts`. Storage uses
`lib/state/index.ts`; provider/session effects use integration APIs. Pure projection
belongs to `lib/projection`. CLI parsing and tool-response formatting stay in adapters.
Local issue state is authoritative; provider-state import requires explicit
initialization or repair. Run `npm run arch:check:strict` after boundary changes.

## Capability contracts

This README is the single application-layer contract; subpackages do not maintain
separate READMEs. Their file responsibilities and API details belong in source JSDoc.

- Runtime writes use fresh locked state, preserve omitted fields and null policy
  snapshots, and keep provider identity immutable. Workflow key/label overrides must
  match resolved configuration; unchanged stored pairs survive configuration drift.
  Transition, notification, and release intents commit atomically. Only explicit
  initialization or token-verified repair may import provider state. Repair rechecks
  snapshots/configuration and worker ownership under lock; inconsistent apply retains
  integrity errors.
- Task creation binds an idempotency key to an immutable payload and persists intent
  before provider mutation. Unknown creation without durable provider identity needs
  manual repair. Projection and provider read-back precede the local ready-state commit.
  Lifecycle commands lock and recheck readiness; body edits preserve managed metadata.
  Attachment capture requires exact project/route identity and saves bytes before upload.
- Application/projection selects exact workflow labels and colors from resolved configuration.
  Workflow label effects add the selected target before removing obsolete configured labels;
  required cleanup failures propagate, while optional final observations remain diagnostic.
  Provider label effects are a two-phase projection: failed cleanup may leave both source
  and target visible. Local reservation/record writes have their own atomic boundary;
  labels, gateway submission and local runtime persistence do not form one transaction.
  Recovery resumes explicit idempotent effects against the same managed issue/worker frame.
  Recovery uses fresh evidence to skip an already applied addition and resume cleanup.
  Provider observations verify projection only and never select local workflow transitions.
- Worker context is checked before reservation. Required task/PR/attachment/instruction
  content remains intact; comments use a count cap and budget, visible omissions, and
  at most one marked fragment. Only full comments receive acknowledgement. UTF-8 byte
  estimates are not model token counts; required overflow blocks dispatch.
  Non-formal review summaries retain local full-content fingerprints scoped to the exact
  PR URL and review ID. Submitted context remains pending until acceptance, exact worker
  completion or explicit operator confirmation; unknown delivery never acknowledges it.
  Completion can confirm captured context before the gateway's final CLI reply, and stale
  submission/session frames cannot confirm replacement turns. Verified non-start discards
  only the matching pending context. Receipts suppress duplicate heartbeat feedback events;
  retried workers still receive original feedback, since delivery does not prove resolution.
  Formal review decisions and edited summaries remain independently actionable.
- Dispatch atomically enforces capacity and execution mode. Proven local rejection
  rolls back reservation; unknown submission retains issue/slot ownership and evidence.
  Pre-submission failure attempts to restore the selected source projection even when adding the
  target succeeded and subsequent cleanup failed. Compensation starts from the attempted
  projection; known or uncertain submitted worker turns keep their reservation instead.
  Session existence alone proves nothing. Recovery persists an immutable operator
  decision before effects and requires exact issue/slot/session/submission identity.
  Pending recovery blocks competing operations; callbacks recheck identity under lock.
  Confirmed start retains ownership; confirmed non-start restores the validated queue
  and releases the exact slot. Completion requires an unambiguous current run and,
  for developers, a live conflict-free open PR; pipeline rechecks under lock.
- Dispatch requires a resolved role and resolves the selected level's explicit model before reservation. Removed or unknown levels fail without restoring registry defaults or interpreting levels as raw model IDs.
- After reservation, dispatch awaits confirmed session model setup before provider transition or worker submission. Setup failure releases the exact reservation while retaining the queued issue; uncertainty in a model patch alone does not imply a submitted worker turn.
- Workers own context-budget reset selection and its audit. Same-issue feedback preserves
  the existing context without querying the gateway; unknown usage retains the
  session. Reset requires observed usage strictly above the configured budget. Observation
  or exceptions from audit retain context; audit persistence remains best-effort. Dispatch
  separately decides how to handle optional
  deletion failure. Gateway adapters neither choose this policy nor write its audit.
- Notifications use the persisted exact endpoint without redirecting. Transport fallback
  is allowed only before submission. Terminal release precedes delivery and archival;
  unknown attempts require exact operator settlement and never automatically resend.
  Retry reservations recheck eligibility under lock; limits count reserved attempts.
- Archival rechecks ownership, releases, notifications, and integrity under lock.
  Deletion cannot discard unsent notification intent; only typed provider not-found
  proves absence. Retention compares fresh complete records, rejects active duplicates
  or occupied slots, and cleans attachments before removing records, retaining cleanup
  intent on failure. Audit never determines readiness, ownership, or recovery state.
- Heartbeat prevents overlapping ticks and runs recovery/maintenance before pickup.
  Recovery failure stops later project phases; workflow failures block that project's
  dispatch without suppressing independent projects. Diagnosis is read-only; remediation
  locks and rechecks local ownership. Provider absence alone never releases active work.
  Session absence in an incomplete gateway inventory is unknown and cannot authorize
  requeue. Uncertain-delivery evidence records that absence as null, retaining reservations.
- Worker bootstrap resolves instruction ownership by exact saved session and project
  agent identity, independently of built-in role names. Ambiguous matches fail closed;
  runtime configuration validates the selected role before any prompt path is read.
  Missing or removed role instructions leave the worker without orchestrator instructions.
- Setup previews are read-only; ordinary setup preserves files. Permissions derive
  from validated ownership in SDK-resolved workspaces, preserve unrelated/global rules,
  and deny nonowners. Corrupt registries block mutation. Routing requires enabled exact
  bindings and rejects conflicting owners; inspection does not prove live connectivity.
  Ownership and SDK configuration are not one transaction. Denied/pending scope evidence
  overrides positive fields; an unavailable scope command is nonblocking.
- Onboarding collects explicit role-level model overrides or accepts defaults. Reconfiguration guidance reads effective enabled workspace roles, including custom levels; it does not discover models or invoke LLM selection.

Within workers, shared root evidence and session policy operations/constants may be imported directly
to avoid command-barrel cycles; recovery must not depend on dispatch. In setup,
shared runtime types come from root `types.ts`, and root contracts may import child
`types.ts` directly to avoid barrel cycles.
