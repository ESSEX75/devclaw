# CLI Layer

This layer owns command-line adapters.

CLI modules parse terminal input, call application use cases, and format terminal
output. Business behavior belongs in `lib/application`, not inside command
handlers.

## Boundary Rules

- Keep command parsing and terminal rendering here.
- Move reusable behavior into `lib/application/*`.
- Do not write directly to provider or OpenClaw adapters when an application use
  case exists.

Use `npm run arch:check:strict` after changing this layer.
