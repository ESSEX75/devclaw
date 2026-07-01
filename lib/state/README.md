# State Layer

This layer owns local persistence.

State modules read, write, migrate, and lock DevClaw project files such as
project config, setup files, and managed issue runtime state. They may use domain
types, but they should not contain queue scheduling or worker dispatch behavior.

## Boundary Rules

- Keep filesystem paths, serialization, migrations, and lock handling here.
- Do not import `lib/tools` or `lib/cli`.
- Do not call provider APIs or OpenClaw session APIs.
- Do not own workflow transitions that require application orchestration.
- Do not reintroduce legacy root stores such as `lib/projects`, `lib/issues`, or
  `lib/config`.

Use `npm run test:issue-state` after changing issue state behavior, and
`npm run arch:check:strict` after structural changes.
