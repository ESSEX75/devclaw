# Managed issue administration

`index.ts` is the supported entrypoint for other application capabilities and
adapters. Child capabilities own their contracts and expose narrow sibling APIs:

- `archive`: archive-first commands, interrupted-transition recovery, read-only
  counts, pure retention planning, and conditional cleanup application.
- `deletion`: exact confirmation, provider absence verification, and tombstone
  recovery after a partial deletion.
- `policy`: explicit review/test policy migration and projection reconciliation.
- `repair`: snapshot-bound plans and verified local/provider-source repair.

Archival rechecks local worker ownership, project worker slots, notification
outbox, and integrity under the issue lock. Terminal archival additionally requires
the current key and label to match a terminal state in the resolved workflow.
Confirmed provider-deleted archival does not require a terminal workflow state.

Deletion refuses an unconfirmed notification before provider effects. It never
marks an unsent notification delivered. A successful provider delete followed by a
local failure returns recovery guidance; a retry first verifies provider absence
and completes local archival without repeating the provider mutation. Only a typed
issue-not-found response proves absence; authorization and transient failures do not.

Retention selects at most `maxItems` records per pass, including skipped stale
candidates. Each candidate is processed under its issue lock, then compared with
the complete fresh archive record under the shared store lock. Active duplicates
and occupied worker slots prevent cleanup. Record expiry always cleans attachments
before removing the record, regardless of the separate attachment window. Failure
leaves the archive recovery record; unrelated or changed records are never merged
from a planning snapshot. Apply results list completed effects only.

State owns attachment cleanup, conditional persistence, and the required retention
intent journal. General application audit remains best-effort. Preview commands
do not delete files or change records. Policy migration determines terminal states
from resolved workflow configuration, including custom states.
