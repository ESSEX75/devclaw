# DevClaw Refactor Architecture Contract

This document defines the enforced source layout for the global refactor. The migration no longer keeps legacy root package facades; old package directories must be removed once their target layer exists.

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
    setup/
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

`integrations` contains concrete adapters for external systems: GitHub, GitLab, OpenClaw runtime, gateway/session calls, and provider-specific API behavior. Target provider implementations belong under `integrations/providers`; legacy `lib/providers` must be removed after migration.

`tools` contains OpenClaw tool adapters only. Tools validate tool input, resolve runtime context, call application use cases, and format tool results.

`cli` contains CLI adapters only. CLI commands parse command-line input, call application use cases, and format terminal output.

`testing` contains harnesses, fakes, and test-only helpers.

## Import Boundaries

- `domain` must not import from `application`, `state`, `integrations`, `tools`, or `cli`.
- `application` may import `domain`, state interfaces/stores, and integration capability interfaces.
- `application` must not import `OpenClawPluginToolContext` or CLI command adapters.
- `state` may import `domain`, but not `tools` or `cli`.
- `integrations` may import `domain` and integration-local types; provider implementations should not own use-case behavior.
- `tools` and `cli` are outer adapters and may call application use cases.
- `testing` may import production modules and test harnesses, but production modules must not import `testing`.

## No-Legacy Policy

The following root packages are legacy and must not exist in the final tree:

- `lib/workflow`
- `lib/providers`
- `lib/projects`
- `lib/issues`
- `lib/config`
- `lib/dispatch`
- `lib/services`
- `lib/setup`

Do not add compatibility facades under these paths. Imports must target the real owner package directly:

- workflow semantics: `lib/domain/workflow`
- project domain types: `lib/domain/projects`
- issue domain types: `lib/domain/issues`
- project state: `lib/state/projects`
- issue state: `lib/state/issues`
- config state: `lib/state/config`
- setup state files and migrations: `lib/state/setup`
- provider adapters: `lib/integrations/providers`
- OpenClaw runtime adapters: `lib/integrations/openclaw`
- use cases: `lib/application/*`

## Enforced Checks

`npm run arch:check:strict` enforces:

- no import cycles across production files;
- no unregistered public OpenClaw tool factories;
- no production imports from `lib/testing`;
- no `domain` imports from outer layers;
- no `state` imports from `tools` or `cli`;
- no `application` imports of `OpenClawPluginToolContext` or `lib/cli/commands/*`;
- no legacy root package directories;
- no relative imports resolving into legacy root packages.

`npm run arch:check` runs the same checks in warn-only mode.
