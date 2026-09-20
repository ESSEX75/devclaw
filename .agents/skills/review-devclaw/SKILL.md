---
name: review-devclaw
description: Perform an adversarial, evidence-based review of DevClaw changes for correctness, recovery, concurrency, type safety, package boundaries, filesystem assumptions, and meaningful test coverage. Use when the user asks to review, audit, harden, find bugs, assess readiness, or inspect changes before a commit. Do not use for ordinary implementation unless a separate review is requested.
---

# Review DevClaw

Review changes as a skeptical maintainer. Look for defects that compilation and happy-path tests can miss. Remain read-only by default: report findings first and modify code only when the user separately asks for fixes.

## Establish the review scope

1. Read the repository `AGENTS.md` and local `WORK_STATE.md` when present.
2. Inspect `git status --short` before other checks so user-owned changes remain identifiable.
3. Determine the exact review target from the request: working tree, staged diff, named commit, commit range, or specific files.
4. Read `devclaw-architecture` completely and the complete `README.md` for every affected top-level `lib/*` package.
5. Inspect both the changed implementation and its callers, public entrypoints, schemas, tests, and persisted or provider-facing contracts.

Do not silently widen the review to unrelated pre-existing changes. Mention relevant out-of-scope risks separately when they materially affect the reviewed code.

## Review behavior, not formatting

Trace realistic executions through the changed code. For each relevant operation, examine initial state, success, failure, retry, concurrency, interruption, and repeated invocation. Focus on externally observable behavior and owned invariants rather than stylistic preference.

Use the following lenses when they apply:

- **Source of truth and ownership:** Verify that domain, application, state, projection, integrations, tools, and CLI each own the decisions assigned to them. Check public entrypoints and dependency direction.
- **Failure and recovery:** Look for rejected promises retained in caches, swallowed errors, partial writes, stale state, missing cleanup, retries that cannot recover, and failures that lose path or operation context.
- **Concurrency and idempotency:** Check lock scope, lost updates, stale snapshots, double execution, ordering assumptions, re-entrancy, duplicate delivery, and whether interrupted operations can resume safely.
- **Persistence integrity:** Check validation before writes, atomic replacement, lock ownership, malformed input, missing files, callback failure, archive/active ordering, and mutation of supposedly immutable snapshots.
- **Type boundaries:** Look for widened `string` keys, lost literal unions, unchecked `unknown`, unsafe assertions, `any`, incomplete records, `Object.fromEntries` widening, and built-in guards incorrectly applied to custom runtime identifiers.
- **Filesystem and packaging:** Verify paths from source, tests, bundles, and installed packages. Check package contents, runtime assets, platform-specific paths, temporary files, backup behavior, and assumptions based on directory depth.
- **Lifecycle and resources:** Check cache invalidation, timers, handles, sessions, locks, temporary artifacts, and cleanup on both success and failure.
- **No-legacy policy:** Reject compatibility aliases, legacy parsing, migrations, and normalization unless the current product contract explicitly requires them.
- **Security boundaries:** Check untrusted input validation, command construction, path traversal, secret exposure, authorization context, and destructive target resolution.
- **Tests as evidence:** Confirm that tests exercise the claimed guarantee, including failure and retry paths. Detect order-dependent, timing-sensitive, self-fulfilling, over-mocked, or implementation-only tests.

Do not mechanically report every checklist item. Investigate the risks introduced by the actual diff and follow evidence into callers or dependencies as needed.

## Validation strategy

- Use read-only searches and focused tests to prove or disprove suspected defects.
- Do not treat green typecheck, lint, build, or tests as evidence that no logical defect exists.
- When the review target changes imports, exports, ownership, persistence, or packaging, inspect the corresponding architecture and artifact contracts explicitly.
- Use `verify-devclaw` only when the user asks for full verification or readiness confirmation. A review does not replace that workflow, and verification does not replace review.
- Do not change tests merely to make nondeterministic behavior pass. First decide whether ordering is a contract; if it is not, test invariant results instead.

## Findings standard

Report only actionable defects or material risks supported by evidence. Order findings by severity:

- **P0:** Immediate data loss, security compromise, or system-wide outage.
- **P1:** Likely correctness failure, unrecoverable workflow, corrupted authoritative state, or broken production/package behavior.
- **P2:** Defect requiring specific conditions, recoverability gap, race, misleading contract, or meaningful missing validation.
- **P3:** Low-impact weakness that can still cause incorrect behavior or conceal a future defect.

Each finding must include:

1. a concise title with priority;
2. the narrowest relevant file and line;
3. the violated invariant or contract;
4. a concrete triggering scenario;
5. the observable consequence;
6. a focused correction direction;
7. the missing or inadequate test, when applicable.

Do not report speculative concerns without a credible execution path. Do not inflate severity. Do not bury findings inside a general summary.

## Review result

Lead with findings. If no actionable findings remain, state that explicitly and list only meaningful residual risks or validation gaps. Then give a compact scope and validation summary.

Never claim code is safe merely because automated checks passed. Distinguish among:

- behavior directly demonstrated by tests or inspection;
- reasonable inference from repository contracts;
- behavior not verified in the current environment.

Do not commit, stage, push, switch branches, or modify external state during review unless the user explicitly requests that separate action.
