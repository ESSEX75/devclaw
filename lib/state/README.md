# State Layer

This layer owns local persistence.

State modules read, write, migrate, and lock DevClaw project files such as
project config, setup files, and managed issue runtime state. They may use domain
types, but they should not contain queue scheduling or worker dispatch behavior.

## Managed Issue Stores

- `issues.json` contains active managed issue state only.
- `issues.archive.json` contains archived records and deletion tombstones only.
- `issue-creations.json` contains resumable creation operations and idempotency
  keys; these records are not active runtime state.
- Both files share one per-project lock. Archival writes the archive record before
  removing active state so an interrupted operation can be recovered idempotently.
- Stores accept only their current strict schema. Destructive reset is an explicit
  operator action and must never run automatically during startup or reads.

## Boundary Rules

- Keep filesystem paths, serialization, migrations, and lock handling here.
- Do not import `lib/tools` or `lib/cli`.
- Do not call provider APIs or OpenClaw session APIs.
- Do not own workflow transitions that require application orchestration.

Use `npm run test` after changing issue state behavior, and
`npm run arch:check:strict` after structural changes.
