# DevClaw Refactor Architecture Contract

This document defines the target source layout for the global refactor. The current runtime modules can remain in their existing locations while the migration happens incrementally.

## Target Layout

```text
lib/
  domain/
  application/
    tasks/
    heartbeat/
    workers/
  state/
    projects/
    issues/
    config/
  integrations/
    providers/
    openclaw/
  tools/
  cli/
  testing/
```

## Layer Ownership

`domain` contains pure types, IDs, policies, workflow semantics, and small domain helpers. It has no IO, no provider calls, no OpenClaw runtime access, and no dependency on higher layers.

`application` contains use cases. It orchestrates domain decisions, state access, and integration capabilities. It must not depend on OpenClaw tool context or CLI command objects.

`state` contains filesystem stores, migrations, locks, serialization, and config/project/issue persistence. It may use domain types, but it must not import OpenClaw tools or CLI adapters.

`integrations` contains concrete adapters for external systems: GitHub, GitLab, OpenClaw runtime, gateway/session calls, and provider-specific API behavior. Target provider implementations belong under `integrations/providers`; existing `lib/providers` may stay temporarily as a migration facade.

`tools` contains OpenClaw tool adapters only. Tools validate tool input, resolve runtime context, call application use cases, and format tool results.

`cli` contains CLI adapters only. CLI commands parse command-line input, call application use cases, and format terminal output.

`testing` contains harnesses, fakes, and test-only helpers.

## Import Boundaries

- `domain` must not import from `application`, `state`, `integrations`, `tools`, or `cli`.
- `application` may import `domain`, state interfaces/stores, and integration capability interfaces.
- `application` must not import OpenClaw tool context or CLI command adapters.
- `state` may import `domain`, but not `tools` or `cli`.
- `integrations` may import `domain` and integration-local types; provider implementations should not own use-case behavior.
- `tools` and `cli` are outer adapters and may call application use cases.
- `testing` may import production modules and test harnesses, but production modules must not import `testing`.

## Migration Rules

- Move behavior one use case at a time.
- Keep public tool names stable.
- Keep state file formats stable unless a task explicitly owns a migration.
- Add facades only when they protect existing imports during incremental moves.
- Remove facades once no production imports need them.

