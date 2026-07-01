# DevClaw — Agent Instructions

DevClaw is an OpenClaw plugin for multi-project dev/qa pipeline orchestration with GitHub/GitLab integration, developer tiers, managed issue runtime state, and audit logging.

## Source Layout

- `index.ts` — plugin entrypoint, registers tools, CLI, services, and hooks.
- `lib/domain` — pure workflow, project, issue, label, and policy semantics.
- `lib/application` — use cases and orchestration: queue ticks, heartbeat passes, task lifecycle, worker dispatch, setup, and review handling.
- `lib/state` — local filesystem state, config, setup files, project stores, issue runtime stores, migrations, and locks.
- `lib/integrations` — GitHub, GitLab, OpenClaw gateway/session, and provider-specific adapters.
- `lib/projection` — deterministic projection between local issue runtime state and provider-visible labels/body metadata.
- `lib/tools` — OpenClaw tool adapters that validate input, resolve runtime context, call application use cases, and format tool results.
- `lib/cli` — command-line adapters that parse terminal input, call application use cases, and format terminal output.
- `lib/testing` — test harnesses, fakes, and test-only helpers.
- `lib/roles` — role registry, model selection, level resolution, and model fetchers.

Detailed architecture contract: `docs/REFACTOR_ARCHITECTURE.md`.

## Runtime State Contract

For initialized DevClaw-managed issues, local issue runtime state is the source of truth. Provider labels and issue body metadata are a visible projection of that state. Manual provider label edits do not become authoritative runtime state unless an explicit repair/backfill flow handles them.

## No-Legacy Policy

Do not create or import from old root packages:

- `lib/workflow`
- `lib/providers`
- `lib/projects`
- `lib/issues`
- `lib/config`
- `lib/dispatch`
- `lib/services`
- `lib/setup`

Imports must target the current owner package directly. Do not add compatibility facades for migrated packages.

## Local Work State

`WORK_STATE.md` is local-only coordination state. It must not be committed or pushed. If it exists, read it after this file. If it does not exist, create it only when a long-running branch needs local coordination state.

Refactor plans, task execution reports, and temporary agent analysis do not belong under `docs/`. Keep them in the operator vault under `vault/generated`.

## Coding Style

- **Separation of concerns** — Each module, function, and class should have a single, clear responsibility. Don't mix I/O with business logic, or UI with data processing.
- **Keep functions small and focused** — If a function does more than one thing, split it up.
- **Meaningful names** — Variables, functions, and files should clearly describe their purpose. Avoid abbreviations unless they're universally understood.
- **No dead code** — Remove unused imports, variables, and unreachable code paths.
- **Favor readability over cleverness** — Straightforward code beats compact one-liners. The next reader (human or agent) should understand the intent without re-reading.

## Conventions

- Never import `child_process` directly — the OpenClaw security scanner flags it. Use `runCommand` from `PluginContext` (`lib/context.ts`), which wraps `api.runtime.system.runCommandWithTimeout`.
- Functions that call `runCommand()` must be async.
- Run `npm run arch:check:strict` after changing layer boundaries, imports, tool registration, or legacy cleanup behavior.

## Verification

- Architecture: `npm run arch:check:strict`
- Typecheck: `npm run check`
- Build: `npm run build`
- Full tests: `npm run test`
- Issue state/projection focus: `npm run test:issue-state`

For local plugin smoke testing:

```bash
npm run build && openclaw gateway restart
openclaw logs
```

Expect: `[plugins] DevClaw plugin registered (... tools, 1 CLI command group, 1 service, 3 hooks)`, where the tool count is read from the current registry.
