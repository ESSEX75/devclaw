# State Layer

This layer owns local persistence.

State modules read, write, and lock DevClaw project files such as
project config, setup files, and managed issue runtime state. They may use domain
types, but they should not contain queue scheduling or worker dispatch behavior.
Strict store envelopes and resumable operation records are state-owned public
contracts exposed to other layers only through `lib/state/index.ts`.

## Package API

- `lib/state/index.ts` is the only supported entrypoint for code outside this layer.
- The root entrypoint explicitly exports supported operations and contracts; wildcard exports are forbidden.
- Internal state modules import implementation owners directly and never import the root entrypoint.
- State schemas, parsers, filesystem locks, and persistence helpers stay private unless an exported operation is itself the required boundary API.
- `lib/state/paths.ts` owns filesystem names shared by multiple state capabilities.
- `lib/state/persistence` owns token-based file locking and atomic replacement used by state repositories; it is not exported from the root API.

## Managed Issue Stores

- `issues.json` contains active managed issue state only.
- Active issue workers may contain an optional unresolved delivery marker; the
  same marker on a project worker slot protects ownership if issue state commit fails.
- `issues.archive.json` contains archived records and deletion tombstones only.
- `issue-creations.json` contains resumable creation operations and idempotency
  keys; these records are not active runtime state.
- `issues/active`, `issues/archive`, and `issues/creation` are separate internal repositories with their own types and strict schemas.
- `issues/persistence` owns the project lock shared by active/archive transactions; neither repository owns the other's synchronization policy.
- Issue-store reads have no write side effects; only locked updates and explicit state-owned transactions initialize or replace durable stores.
- Active and archive files share one per-project lock. Archival writes the archive record before
  removing active state so an interrupted operation can be recovered idempotently.
- Terminal notification reservations use a bounded attempt lease: delivered events remain deduplicated, while an unconfirmed attempt becomes reservable again after the lease expires.
- Stores accept only their current strict schema. Destructive reset is an explicit
  operator action and must never run automatically during startup or reads.
- Stores accept only the current strict schema at the filesystem boundary; no legacy normalization or migration runs during reads.

## Projects Registry

- `projects/paths` owns registry and repository path policy, including home-directory expansion.
- `projects/repository` owns strict reads and immutable, locked atomic updates; raw production writes are not public.
- `projects/queries` contains pure snapshot lookups, while `projects/mutations` owns worker-slot persistence operations.
- Project queries and mutations accept only the canonical project slug; notification routing is resolved before entering state.
- Canonical slugs use strict lowercase kebab-case and must match their registry key; display names never address files or registry entries.
- The registry accepts only its current schema and performs no legacy field or identifier normalization.

## Configuration Pipeline

- YAML boundary reads return `unknown`; only the strict current schema creates raw configuration values.
- Pure merge preserves built-in → workspace → project precedence, including explicit role and level disabling.
- Resolution completes runtime contracts before separate role/workflow cross-reference integrity checks.
- Project configuration paths are addressed only by the validated canonical slug.
- Only `loadConfig` and resolved runtime selectors are public outside state; parsing details remain internal.

## Setup Files

- Template loading is explicit and asynchronous; import-time filesystem reads are forbidden.
- Initialization is create-only, while system instruction refresh and default reset are explicit capabilities.
- Reset preserves adjacent `.bak` files as a recovery feature, not as a compatibility mechanism.
- Workspace version tracking and legacy onboarding-file cleanup are not part of the new-project contract.
- Project-specific role prompts are addressed only by the validated canonical slug.

## Boundary Rules

- Keep filesystem paths, serialization, and lock handling here.
- Do not import `lib/tools` or `lib/cli`.
- Do not call provider APIs or OpenClaw session APIs.
- Do not own workflow transitions that require application orchestration.

Use `npm run test` after changing issue state behavior, and
`npm run arch:check:strict` after structural changes.

Workflow model patch persistence preserves other YAML settings and comments and
creates a backup. Scoped configuration resets and workflow document reads belong
to state; application selects the operation and validates configured identifiers.
