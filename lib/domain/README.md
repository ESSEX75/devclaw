# Domain Layer

This layer owns pure DevClaw semantics.

Domain modules define workflow types, role/project/issue concepts, labels,
policies, IDs, and deterministic helper functions. Code here should be safe to
execute without filesystem access, provider clients, OpenClaw runtime context, or
CLI state.

Package ownership is explicit: `notifications` owns messaging endpoints and
notification routing labels, `issues` owns provider IDs and issue ownership,
`projects` owns project and worker-slot structures, and `workflow` owns state
machine semantics and workflow routing.

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
- Code outside `lib/domain` imports domain entities from `lib/domain/index.ts`.
- Cross-subpackage imports use the target subpackage's `index.ts`.
- Domain internals never import from the root `lib/domain/index.ts` barrel.

## Domain-specific contracts

- Keep YAML parsing, Zod boundary schemas, persistence, migrations, locks, provider calls, audit logging, and runtime orchestration outside this layer.
- Derive closed domain value unions from their canonical constant registries through `ValueOf`.
- Keep narrow built-in identifiers distinct from extensible identifiers validated from resolved runtime configuration.
