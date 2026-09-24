# Managed Issue Repair

This subpackage owns explicit repair of initialized issue runtime state and its provider projection.

`index.ts` exposes the repair command, source and error constants, stable result types, and failure guard to adapters. `command.ts` coordinates dry-run, locked apply, plan-token validation, quota preflight, audit, and post-apply verification. `context.ts` reads detached local and provider snapshots. `plan.ts` calculates a deterministic plan without I/O. `apply.ts` keeps local-source provider writes and provider-source local writes separate. `failure.ts` maps expected failures into the shared result contract.

Apply requires a token from a prior dry-run. The command re-reads both snapshots under the issue orchestration lock and rejects a stale token. An active worker blocks apply. A failed or inconsistent apply leaves local integrity in `integrity_error`; a verified no-op clears a stale integrity error. The local runtime record remains authoritative except during an explicitly selected provider-source import.
