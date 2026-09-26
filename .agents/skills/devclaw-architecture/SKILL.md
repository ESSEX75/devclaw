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

### Exported type placement

- Declare every exported TypeScript `type` and `interface` in the owning package or subpackage's `types.ts`.
- Implementation files such as `repository.ts`, `templates.ts`, `queries.ts`, and `workspace-files.ts` may declare file-local types only when those types are not exported.
- When a file-local type becomes shared or exported, move its declaration to the nearest owning `types.ts` and import it with a top-level `import type` declaration.
- A package `index.ts` may re-export supported types from `types.ts`, but must not own their declarations or re-export their declarations from implementation files.
- Keep each `types.ts` cohesive to its owning package or subpackage; do not use this rule to create a cross-package type dumping ground.

### Nested types and readability

- Prefer a named file-local type for a nested object shape or array element when its fields and JSDoc make the containing contract harder to scan. For example, use `agents: DoctorAgentToolAccess[]` instead of an inline `Array<{ ... }>` block.
- Keep the extracted type in the same file without `export` when it is used only there, including when it supports an exported contract in `types.ts`. Export it only when another file needs the named contract, following the exported type placement rules above.
- Preserve meaningful JSDoc on the extracted type and its fields. Reuse an existing owner type when it already represents the same concept; do not duplicate it merely to shorten the declaration.

### Constant placement and string literals

- Move filesystem and resource identifiers into documented constants even when a value currently appears only once. This includes filenames, directory names, extensions, backup suffixes, relative paths, template paths, and path-segment collections.
- Move repeated or architecturally meaningful protocol identifiers, prefixes, event names, labels, and policy values into documented constants instead of embedding string literals in implementation code.
- Put constants shared within a package or subpackage in its `const.ts`. Keep a constant in an implementation file only when it is private to that file and does not represent a filesystem path, resource name, or shared architectural identifier.
- Build dynamic names and paths from the smallest meaningful constants, such as a role identifier plus a filename-extension constant.
- Do not export internal constants from a package entrypoint unless external consumers are intentionally supported users of that contract.
- Ordinary user-facing prose, error messages, log messages, and isolated test descriptions do not need constants unless code compares, parses, or otherwise relies on their exact value.

## File and API documentation

- Start every source file, including existing production and test files, with a concise file-level JSDoc comment.
- Explain why the file exists, what responsibility it owns, and where it sits in the architecture.
- Add meaningful JSDoc to every type, interface, class, module-level constant, named function declaration, and class/object method, including non-exported and private declarations. Inline callbacks and ordinary local variable bindings do not require separate JSDoc.
- Document every declaration even when its purpose appears obvious from its name or signature; triviality is not a reason to omit documentation.
- Begin every function or method JSDoc with a concise description of its purpose and behavior. A block containing only tags such as `@param` is incomplete.
- Give every property declared by an interface or object-shaped type alias its own JSDoc comment, even when the property appears self-explanatory. This applies to nested declared contract objects as well as top-level fields.
- Document function behavior, important guarantees, side effects, and failure conditions that are not obvious from the signature.
- Include one `@param name - Description.` tag for every parameter of every documented function or method. Because every new or materially changed function declaration and method must be documented, none of their parameters may be omitted. Describe semantic purpose, constraints, defaults, ownership, or lifecycle role; do not repeat the TypeScript type.
- Keep `@param` tags in signature order. Document destructured parameters by their signature name when one exists; otherwise name the meaningful destructured path, such as `@param input.projectSlug`.
- Do not add `@returns` tags. Describe relevant result semantics in the prose description when they are not already clear from the signature.
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
 *
 * @param workspaceDir - The workspace containing the authoritative issue state.
 * @param project - The project whose notification endpoints may satisfy the binding.
 * @param issueId - The provider-local issue identifier.
 */
export async function resolveIssueNotificationEndpoint(workspaceDir, project, issueId) {
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
- every exported `type` and `interface` is declared in the owning package or subpackage's `types.ts`;
- filesystem/resource strings and shared architectural identifiers are owned by documented constants in the appropriate `const.ts`;
- private helpers remain private;
- imports use the appropriate public entrypoint without creating cycles;
- every source file has a meaningful file-level JSDoc header;
- every type, interface, class, module-level constant, named function, and method has useful JSDoc;
- every function and method JSDoc contains prose describing behavior rather than tags alone;
- every interface and object-shaped type property has its own JSDoc comment;
- every documented function or method parameter has an ordered `@param` entry without a duplicated TypeScript type;
- no JSDoc contains an `@returns` tag;
- comments describe current behavior rather than historical implementation;
- relevant tests cover the changed behavior.

After changing boundaries, imports, or exports, run `npm run arch:check:strict`. Run the complete DevClaw verification workflow before committing broad architectural work.
