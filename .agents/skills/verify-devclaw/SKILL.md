---
name: verify-devclaw
description: Run the complete DevClaw repository verification workflow. Use before committing, after broad refactors, after changing imports or package boundaries, or whenever the user asks to verify, validate, check, or confirm repository changes.
---

# Verify DevClaw

Inspect `git status --short` before running checks so pre-existing user changes remain identifiable.

Run these checks in order and stop at the first failure:

1. `npm run arch:check:strict`
2. `npm run check`
3. `npm run build`
4. `npm run test`
5. `npm run test:issue-state`
6. `git diff --check`
7. `git status --short`

On Windows PowerShell, use `npm.cmd` instead of `npm` when the execution policy blocks `npm.ps1`.

## Failure handling

- Diagnose the underlying failure before changing code.
- Fix failures only when the current task authorizes implementation. For review-only requests, report the failure without modifying files.
- Do not disable or weaken TypeScript, ESLint, architecture, build, or test checks.
- Re-run the failed check after a fix, then continue through the remaining checks.
- Preserve unrelated user changes and generated artifacts already present before verification.

## Reporting

Report:

- every check that passed or failed;
- test suite and test case totals when available;
- the first actionable failure with its file and cause;
- remaining modified, staged, and untracked files;
- whether verification itself changed the working tree.

Do not stage, commit, amend, or push unless the user explicitly requests that separate action.
