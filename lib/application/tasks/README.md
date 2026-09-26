# Managed tasks

`index.ts` exposes task operations to adapters and other application capabilities.
Each child capability owns its implementation and exposes a narrow `index.ts` to
sibling capabilities:

- `creation`: durable provider creation, verified projection, and recovery.
- `lifecycle`: claim, approval, prepared levels, and user-content edits under the
  issue orchestration lock. Commands recheck creation readiness before effects.
- `queries`: read-only task listings and local/provider projection diagnostics.
- `attachments`: manual and automatic media orchestration, exact project routing,
  upload, comments, and worker display. Persistence belongs to state/attachments.
- `context`: deterministic worker messages and dispatch announcements.

Body edits retain authoritative runtime metadata and the trusted creation marker.
Submitted managed blocks cannot replace them. Provider content and local state are
read after taking the same issue lock used by lifecycle transitions.

Attachment capture requires a complete channel/account/conversation/thread/agent
identity and exactly one project in the configured owner's workspaces. Missing
identity is skipped; ambiguous or unreadable registries are errors. SDK event
parsing and hook registration belong to integrations/openclaw.

Both attachment entry paths save local bytes before attempting upload. Confirmed
URLs are persisted through the state repository; a late upload cannot recreate a
purged index entry. Upload failures retain the local file and are audited; storage
failures propagate. Retrying an explicit add creates another attachment, so callers
must inspect local state after a partial failure rather than blindly resubmit.
