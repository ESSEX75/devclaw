# Roles Package

This package owns the built-in role registry, level lookup, model selection, worker naming, and role instruction loading used by orchestration.

## Boundary Rules

- Keep built-in registry data and deterministic role/level lookups here.
- Accept resolved runtime role configuration when custom roles or overrides must be supported; do not reject valid custom identifiers through built-in-only guards.
- Keep queue scheduling, worker dispatch, persistence, and provider operations in their owning packages.
- Iterate the built-in registry through `getAllRoleIds()` rather than `Object.entries(ROLE_REGISTRY)`.

Run `npm run check` and relevant role/configuration tests after changing this package.
