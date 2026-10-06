# Roles Package

This package owns the built-in role registry, level lookup, model selection, worker naming, and role instruction loading used by orchestration.

Model assignments are explicit role-level configuration values. This package does not discover external model catalogs or invoke an LLM to generate assignments.

Runtime model resolution requires a complete resolved role and reads only its configured levels. Unknown levels and empty assignments fail; registry defaults are applied by the configuration pipeline, never during dispatch.

## Boundary Rules

- Keep built-in registry data and deterministic role/level lookups here.
- Accept resolved runtime role configuration when custom roles or overrides must be supported; do not reject valid custom identifiers through built-in-only guards.
- Keep queue scheduling, worker dispatch, persistence, and provider operations in their owning packages.
- Iterate the built-in registry through `getAllRoleIds()` rather than `Object.entries(ROLE_REGISTRY)`.

Run `npm run check` and relevant role/configuration tests after changing this package.
