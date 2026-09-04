---
name: devclaw-architecture
description: Preserve DevClaw package ownership, layer boundaries, public APIs, imports, exports, file responsibilities, and code documentation. Use when creating, moving, reviewing, or refactoring files or packages anywhere in the DevClaw repository.
---

# DevClaw Architecture

Preserve package ownership and dependency direction across the complete repository. Keep this skill focused on shared architectural procedure; package-specific rules belong in the package's `README.md` next to its code.

## Start with package contracts

Before changing code:

1. Identify every affected `lib/*` package and subpackage.
2. Read the complete `README.md` of each affected top-level package when it exists.
3. Inspect nearby `index.ts` files, existing responsibilities, and current consumers.
4. Apply both this shared skill and the local package contracts.

If an architectural change alters a package's ownership or boundary, update that package's `README.md` in the same change. Do not copy package-specific rules into this skill.

## Ownership and placement

- Give every file one clear owner and responsibility.
- Place behavior in the lowest layer that owns the required knowledge.
- Follow the affected package README for concrete ownership, allowed dependencies, and layer-specific boundaries.
- Do not create generic `utils.ts`, `helpers.ts`, or `types.ts` dumping grounds spanning unrelated owners.
- Do not create compatibility facades for legacy packages.

## Subpackage structure

- Organize every large package by cohesive responsibility instead of placing unrelated files together at its root.
- Apply this rule to every current and future package without maintaining an allowlist in this skill.
- Create a subpackage when several files implement one stable capability, share a public contract, or change for the same architectural reason.
- Keep a small, isolated responsibility as a focused file until a real subpackage boundary exists; do not create directories only for visual symmetry.
- Name each subpackage after the cohesive capability or responsibility it owns; new valid responsibilities require no skill update.
- Give a subpackage an `index.ts` when it exposes a supported API to other packages or sibling subpackages.
- Allow direct imports between implementation files inside the same subpackage; use its public entrypoint across an established public boundary.
- Split an oversized subpackage by cohesive capability, not merely by technical categories or arbitrary file counts.
- Avoid vague ownership names unless the package README defines a narrow, durable responsibility for them.

## Package APIs and imports

- Treat a directory with an `index.ts` as an explicit package or subpackage API.
- Re-export only supported entities owned by that package.
- Keep file-local implementation details private.
- Import through the target package's `index.ts` when it defines a public API for the consumer's boundary.
- Allow direct imports between implementation files inside the same package.
- Do not import a package through its own barrel from inside that package; avoid cycles.
- Do not re-export an entity from a package that does not own it.
- Do not create a large top-level barrel merely to hide legitimate internal package structure.
- Use `.js` extensions in TypeScript import and export paths.

Follow stricter import rules stated in the affected package README.

## File organization

Create files according to real responsibilities, not a mandatory template. Use these names consistently when the responsibility exists:

- `index.ts`: supported public API of a package or subpackage.
- `const.ts`: shared value registries, identifiers, prefixes, colors, events, and policies.
- `types.ts`: shared contracts and derived types.
- `guards.ts`: runtime type guards and domain value-set membership checks.
- `queries.ts`: read-only queries.
- `schema.ts`: boundary validation and parsing schemas.
- `defaults.ts`: structured built-in defaults.

Prefer focused names that communicate the file's owned responsibility.

## File and API documentation

- Start every new source file with a concise file-level JSDoc comment.
- Explain why the file exists, what responsibility it owns, and where it sits in the architecture.
- Add concise JSDoc to every newly exported function, type, interface, class, and constant.
- For exported functions, document behavior, important guarantees, side effects, and failure conditions that are not obvious from the signature.
- Add `@param` and `@returns` documentation when it improves the public API description.
- Use these tags to explain semantic meaning, purpose, constraints, defaults, ownership, or lifecycle behavior; avoid descriptions that only restate the parameter name or TypeScript type.
- Document public contract fields whose meaning, source of truth, or lifecycle is not obvious.
- Avoid comments that merely restate an identifier or narrate individual code statements.
- Update comments when behavior or ownership changes; stale documentation is an architectural defect.

Example file header:

```ts
/**
 * Resolves a managed issue's stable notification binding into a transport endpoint.
 * This application service reads local state but performs no message delivery.
 */
```

Example exported function:

```ts
/**
 * Resolves the endpoint selected in local issue state.
 * Returns undefined when the binding no longer exists; it never falls back to another endpoint.
 */
export async function resolveIssueNotificationEndpoint(/* ... */) {
  // ...
}
```

Useful parameter documentation may be concise:

```ts
/**
 * @param fn - The target function to bind to the context.
 */
```

## TypeScript boundaries

- Keep untrusted values as `unknown` until a guard or schema validates them.
- Do not introduce `any` or type assertions to bypass ownership or type errors.
- Use top-level `import type` declarations instead of inline imports.
- Preserve types derived from canonical constant registries.
- Distinguish built-in identifiers from identifiers validated from resolved runtime configuration.
- Put validation at the boundary that owns the input; do not make inner layers guess malformed shapes.

## Review checklist

Before completing an architectural change, verify that:

- every changed file belongs to its package;
- large packages and capabilities remain divided into cohesive subpackages;
- affected package README contracts were read and remain accurate;
- dependency direction follows package boundaries;
- public entities are exported from the correct owner API;
- private helpers remain private;
- imports use the appropriate public entrypoint without creating cycles;
- new files have a meaningful file-level JSDoc header;
- new exported entities have useful JSDoc;
- comments describe current behavior rather than historical implementation;
- relevant tests cover the changed behavior.

After changing boundaries, imports, or exports, run `npm run arch:check:strict`. Run the complete DevClaw verification workflow before committing broad architectural work.
