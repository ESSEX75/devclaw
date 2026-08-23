---
name: domain-architecture
description: Preserve the structure, public APIs, imports, exports, purity, constants, types, and guards of lib/domain. Use when creating, moving, reviewing, or refactoring domain files or subpackages.
---

# Domain Architecture

Treat `lib/domain` as the pure business core of DevClaw. Keep filesystem, network, process, provider, and OpenClaw runtime I/O outside this package.

Before changing a domain subpackage, read `lib/domain/README.md` and inspect its existing `index.ts`, contracts, and consumers.

## Package structure

Maintain domain behavior in focused subpackages:

```text
lib/domain/
├── index.ts
├── issues/
├── notifications/
├── projects/
└── workflow/
```

Treat these directories as domain subpackages with explicit public APIs. Controlled dependencies between subpackages are allowed through the target subpackage's `index.ts`.

Do not require every subpackage to contain the same files. Create a file only when its responsibility exists. Prefer these conventional responsibilities:

- `index.ts`: public API of the subpackage.
- `const.ts`: domain value registries, identifiers, policies, events, prefixes, colors, and other shared constants.
- `types.ts`: domain contracts and derived types.
- `guards.ts`: runtime type guards and domain value-set predicates.
- `queries.ts`: pure read-only queries.
- `defaults.ts`: built-in default definitions.

Use focused names such as `ownership.ts`, `routing.ts`, `slots.ts`, `completion.ts`, and `labels.ts` instead of forcing unrelated behavior into a generic `operations.ts`.

## Public API and imports

- Treat `lib/domain/index.ts` as the public entry point for the complete domain package.
- Give every domain subpackage its own `index.ts`.
- Re-export each subpackage's supported public API from its `index.ts`.
- Re-export every subpackage public API from `lib/domain/index.ts`.
- Import domain entities outside `lib/domain` only from `lib/domain/index.ts`.
- Import files within the same subpackage directly.
- Import across domain subpackages from the target subpackage's `index.ts`.
- Never import the root `lib/domain/index.ts` barrel from inside `lib/domain`; avoid circular dependencies.
- Never re-export an entity from a subpackage that does not own it.
- Keep file-local helpers private. Do not expose implementation details through barrel files.
- Use `.js` extensions in TypeScript import and export paths.

## Pure domain behavior

- Keep domain functions deterministic and free of external I/O.
- Return derived values or transformed in-memory objects instead of mutating external state.
- Keep persistence, YAML parsing, Zod boundary schemas, migrations, locks, provider calls, and runtime orchestration in their owning non-domain packages.
- Keep full configuration validation in `lib/state/config`; domain guards must not replace boundary schemas or post-merge integrity validation.

## Constants and types

- Move a value to `const.ts` when it is a reusable domain identifier, belongs to a closed built-in value set, participates in type derivation, or is shared by domain modules.
- Keep local error messages, descriptions, and implementation-only strings near their use unless they form a shared contract.
- Keep built-in default definitions in `defaults.ts` when they describe structured behavior rather than a value registry.
- Derive domain value unions through the existing `SoftUnion` type.
- Do not modify `SoftUnion<T> = T[keyof T]`.
- Do not replace a domain type with `string` merely to bypass an error.
- Distinguish narrow built-in identifiers from identifiers validated in resolved runtime configuration.
- Use `as const` only to preserve literal values in constant registries. Do not use type assertions to convert one domain type into another.

Example:

```ts
import type { SoftUnion } from "../../../types.js";
import { DOMAIN_VALUE } from "./const.js";

/** Built-in domain value identifier. */
export type DomainValue = SoftUnion<typeof DOMAIN_VALUE>;
```

## Guards

- Put a function in `guards.ts` only when it narrows a TypeScript type or verifies membership in a domain value set.
- Do not move an ordinary boolean query into `guards.ts` merely because it returns `boolean`.
- Accept `unknown` at an untrusted boundary and narrow it through runtime comparisons.
- Name built-in guards explicitly when custom runtime identifiers are supported.
- Do not use type assertions inside guards.

Example:

```ts
/** Checks whether a value is a built-in domain value. */
export function isBuiltInDomainValue(value: unknown): value is DomainValue {
  return typeof value === "string"
    && Object.values(DOMAIN_VALUE).some((entry) => entry === value);
}
```

## Documentation

- Add concise JSDoc to exported domain constants, types, guards, queries, and operations.
- Document public contract fields whose meaning, constraints, or lifecycle are not obvious from their names.
- Document constant members when they represent domain behavior or policy.
- Avoid comments that only repeat the identifier name.

## Review checklist

Before completing a domain change, verify that:

- the code belongs in `lib/domain` and performs no I/O;
- the source subpackage owns every exported entity;
- its `index.ts` exports the intended public API;
- `lib/domain/index.ts` exposes domain API needed by external consumers;
- external consumers import from `lib/domain/index.ts`;
- internal cross-subpackage imports use the target subpackage's `index.ts`;
- no domain file imports from the root domain barrel;
- constants and derived types have one source of truth;
- guards narrow honestly without assertions;
- private helpers remain private;
- relevant tests cover the changed behavior.

After changing boundaries, imports, or exports, run `npm run arch:check:strict`. Then run `npm run check` and the relevant tests. Apply the complete verification workflow before committing.
