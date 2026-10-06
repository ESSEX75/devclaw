# Roles Package

This package owns built-in role defaults, their query API, task complexity classification, rank-based level selection, and strict model lookup. Runtime role configuration is resolved by `lib/state/config`; worker naming and instruction files belong to their existing owners outside this package.

Model assignments are explicit role-level configuration values. This package does not discover external model catalogs or invoke an LLM to generate assignments.

Runtime model resolution requires a complete resolved role and reads only its configured levels. Unknown levels and empty assignments fail; registry defaults are applied by the configuration pipeline, never during dispatch.

Text complexity classification is independent of role scales. Complex signals take priority over simple keywords, with whole-word/phrase matching. Level selection maps explicit or classified complexity to minimum rank, configured default, or maximum rank; explicit complexity wins over text. Both operations are pure and accept custom configured scales.

## Boundary Rules

- Keep built-in registry data and deterministic role/level lookups here.
- Accept resolved runtime role configuration when custom roles or overrides must be supported; do not reject valid custom identifiers through built-in-only guards.
- Keep queue scheduling, worker dispatch, persistence, and provider operations in their owning packages.
- Import supported operations and types through `lib/roles/index.ts`. Default data in `defaults.ts` is internal and is not re-exported.
- Iterate built-in roles through `getAllRoleIds()` and read independent readonly snapshots through `getBuiltInRole()` or `requireBuiltInRole()`. Mutating a returned snapshot cannot change future reads.
- Built-in queries are explicitly named; runtime role/level membership and model selection use resolved configuration. No role can be inferred uniquely from a shared level identifier.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `defaults.ts` | Built-in role definitions used by the first configuration layer. |
| `queries.ts` | Isolated snapshots and supported built-in presentation queries. |
| `const.ts` | Built-in model IDs, fallback emoji, and complexity policy values. |
| `types.ts` | Readonly built-in snapshots and runtime selection contracts. |
| `guards.ts` | Validation of untrusted explicit complexity values. |
| `task-complexity.ts` | Text classification independent of role scales. |
| `level-selection.ts` | Mapping complexity to configured ranks and default level. |
| `model-resolution.ts` | Strict lookup of a configured level's model. |

Run `npm run check` and relevant role/configuration tests after changing this package.
