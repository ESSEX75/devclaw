# Domain Layer

This layer owns pure DevClaw semantics.

Domain modules define workflow types, role/project/issue concepts, labels,
policies, IDs, and deterministic helper functions. Code here should be safe to
execute without filesystem access, provider clients, OpenClaw runtime context, or
CLI state.

Domain may define the semantic issue and project records used by persistence,
but store envelopes and resumable operation records belong to
`lib/state`.

Package ownership is explicit: `notifications` owns messaging endpoints and
notification routing labels, `issues` owns provider IDs and issue ownership,
`projects` owns project and worker-slot structures, `workers` owns shared worker
delivery status, and `workflow` owns state machine semantics and workflow routing.

Workflow owns saved policy selectors and their local issue-field identifiers shared
by candidate selection and transition rechecks.

Workflow owns policy-label prefixes shared by projection rendering, repair parsing,
and application label effects. Issue semantics own the diagnostic used to preserve
a non-OK integrity status when its original diagnostic owner is unknown.

Worker slot and active issue records share a durable delivery marker so both
local ownership views can represent an unconfirmed worker turn.

## Boundary Rules

- Do not import from `lib/application`, `lib/state`, `lib/integrations`,
  `lib/tools`, or `lib/cli`.
- Do not perform IO.
- Do not know about GitHub, GitLab, OpenClaw sessions, or command-line parsing.
- Do not place migrations here.

If a function needs runtime state, provider data, or filesystem access, it belongs
outside `lib/domain`.

## Public API

- `lib/domain/index.ts` is the public entrypoint for the complete domain package.
- Every domain subpackage exposes its supported API through its own `index.ts`.
- The root entrypoint re-exports the supported subpackage APIs with `export *`;
  subpackage entrypoints explicitly select the values and types they expose.
- Code outside `lib/domain` imports domain entities from `lib/domain/index.ts`.
- Cross-subpackage imports use the target subpackage's `index.ts`.
- Domain internals never import from the root `lib/domain/index.ts` barrel.

## Domain-specific contracts

- Keep YAML parsing, Zod boundary schemas, persistence, migrations, locks, provider calls, audit logging, and runtime orchestration outside this layer.
- Derive closed domain value unions from their canonical constant registries through `ValueOf`.
- Keep narrow built-in identifiers distinct from extensible identifiers validated from resolved runtime configuration.

Issue semantics own terminal-notification states: pending, attempting, delivered, blocked,
retryable, and unknown. Attempt timestamps identify the owned send, while persisted
reasons distinguish policy blocks from uncertain external effects.

A completed issue may retain the exact worker identity awaiting project-slot
release. This is an ownership guard until application recovery finishes the release.

Worker delivery markers carry a submission ID distinct from reusable session
identity. Domain owns operator decision values; state owns resumable decision records.
