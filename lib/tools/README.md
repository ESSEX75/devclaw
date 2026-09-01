# Tools Layer

This layer owns OpenClaw tool adapters.

Tool modules validate tool inputs, resolve runtime context, call application use
cases, and format tool results for OpenClaw. They are the boundary between the
agent-facing plugin API and deterministic DevClaw behavior.

## Boundary Rules

- Keep OpenClaw tool context handling here.
- Move reusable business behavior into `lib/application/*`.
- Do not access provider or state internals directly when an application use case
  exists.
- Register public tool factories in `lib/tools/registry.ts`.

Use `npm run arch:check:strict` after adding or changing tool factories.
