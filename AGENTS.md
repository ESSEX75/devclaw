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

Layer-specific contracts live in the `README.md` files under each `lib/*` package. Read the complete README for every affected package before changing it.

## Package APIs

- A directory with an `index.ts` exposes an explicit package or subpackage API.
- Import through that entrypoint across its public boundary; keep direct implementation imports inside the owning package unless its README specifies otherwise.
- Do not import a package through its own barrel from inside that package.
- Re-export only supported entities owned by the package, and keep file-local implementation details private.
- Do not create a top-level barrel for an organizational layer unless it represents a real supported API.
- Any stricter package-specific API rules belong in that package's README.

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

## Coding Style

- **Separation of concerns** — Each module, function, and class should have a single, clear responsibility. Don't mix I/O with business logic, or UI with data processing.
- **Keep functions small and focused** — If a function does more than one thing, split it up.
- **Meaningful names** — Variables, functions, and files should clearly describe their purpose. Avoid abbreviations unless they're universally understood.
- **No dead code** — Remove unused imports, variables, and unreachable code paths.
- **Favor readability over cleverness** — Straightforward code beats compact one-liners. The next reader (human or agent) should understand the intent without re-reading.

## Code Documentation

- Start every new source file with a concise JSDoc header explaining why the file exists and which architectural responsibility it owns.
- Add meaningful JSDoc to every newly exported function, type, interface, class, and constant.
- Describe non-obvious guarantees, side effects, failure conditions, and source-of-truth semantics.
- Do not add comments that merely repeat names, types, or individual statements.
- Keep documentation synchronized with behavior and package ownership.

## TypeScript Contracts

- Do not use type assertions (`as SomeType`) to bypass type errors. Fix the source type or validate unknown input with a type guard or schema.
- Do not introduce `any`. Keep untrusted boundary values as `unknown` until validated.
- Do not use inline type imports such as `import("./types.js").Type`; use top-level `import type` declarations.
- Do not modify `ValueOf<T> = T[keyof T]` or replace domain types derived through it with primitive aliases.
- Keep built-in identifiers distinct from identifiers validated from resolved runtime configuration. Built-in guards must be named accordingly and must not reject valid custom configuration in runtime paths.
- Put shared domain constants in `const.ts`, domain types in `types.ts`, and runtime type guards in `guards.ts`.
- A boolean predicate belongs in `guards.ts` only when it narrows a TypeScript type or validates membership in a domain value set.

## Conventions

- Never import `child_process` directly — the OpenClaw security scanner flags it. Use `runCommand` from `PluginContext` (`lib/context.ts`), which wraps `api.runtime.system.runCommandWithTimeout`.
- Functions that call `runCommand()` must be async.
- Run `npm run arch:check:strict` after changing layer boundaries, imports, tool registration, or legacy cleanup behavior.
- Use `getAllRoleIds()` for role registry iteration instead of `Object.entries(ROLE_REGISTRY)`.

## Git Safety

- Do not commit unrelated user changes.
- Do not push unless the user explicitly requests it.
- Run the required verification before creating a commit and stage only files belonging to the requested change.

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
