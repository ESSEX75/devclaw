# Roles Package

This package owns built-in role defaults, their query API, task complexity classification, rank-based level selection, and strict model lookup. Runtime role configuration is resolved by `lib/state/config`; worker naming and instruction files belong to their existing owners outside this package.

Model assignments are explicit role-level configuration values. This package does not discover external model catalogs or invoke an LLM to generate assignments.

Runtime model resolution requires a complete resolved role and reads only its configured levels. Unknown levels and empty assignments fail; registry defaults are applied by the configuration pipeline, never during dispatch.

Text complexity classification is independent of role scales. Complex signals take priority over simple keywords, with whole-word/phrase matching. Level selection maps explicit or classified complexity to minimum rank, configured default, or maximum rank; explicit complexity wins over text. Both operations are pure and accept custom configured scales.

## Boundary Rules

- Keep built-in registry data and deterministic role/level lookups here.
- Accept resolved runtime role configuration when custom roles or overrides must be supported; do not reject valid custom identifiers through built-in-only guards.
- Keep queue scheduling, worker dispatch, persistence, and provider operations in their owning packages.
- External consumers import supported operations and types through `lib/roles/index.ts`. Inside roles, use sibling capability entrypoints; never import the root or a capability's own barrel internally.
- Default data in `built-in/defaults.ts` is private to that capability and is not re-exported from either entrypoint.
- Iterate built-in roles through `getAllRoleIds()` and read independent readonly snapshots through `getBuiltInRole()` or `requireBuiltInRole()`. Mutating a returned snapshot cannot change future reads.
- Built-in queries are explicitly named; runtime role/level membership and model selection use resolved configuration. No role can be inferred uniquely from a shared level identifier.

## Responsibilities

| Capability | Responsibility |
| --- | --- |
| `built-in` | Default definitions, isolated snapshots, and presentation queries. Owns built-in model IDs and readonly snapshot types. |
| `complexity` | Text classification, complexity policy constants, category types, and validation of explicit signals. Has no dependency on role scales. |
| `selection` | Mapping complexity to configured ranks/default level and strict lookup of configured models. Owns minimal resolved contracts and depends only on the complexity capability. |

Each capability exposes supported operations and types through its own `index.ts`.
Tests stay beside implementation; constants and types stay with their capability.
The root entrypoint preserves the external roles API. Contracts live only in this README.

Run `npm run check` and relevant role/configuration tests after changing this package.
