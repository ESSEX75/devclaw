# CLI Layer

This layer owns command-line adapters.

CLI modules parse terminal input, call application use cases, and format terminal
output. Business behavior belongs in `lib/application`, not inside command
handlers.

The `worker-delivery` command previews or applies an operator-verified conclusion
for an unresolved worker turn. It requires the exact session key and an audit reason;
application code validates the fresh issue and slot before changing either.

## Boundary Rules

- Keep command parsing and terminal rendering here.
- Move reusable behavior into `lib/application/*`.
- Do not write directly to provider or OpenClaw adapters when an application use
  case exists.

Use `npm run arch:check:strict` after changing this layer.
