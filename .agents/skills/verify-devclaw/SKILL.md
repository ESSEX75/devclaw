---
name: verify-devclaw
description: Run the complete DevClaw repository verification workflow. Use before committing, after broad refactors, after changing imports or package boundaries, or whenever the user asks to verify, validate, check, or confirm repository changes.
---

# Verify DevClaw

Inspect `git status --short` before running checks so pre-existing user changes remain identifiable.

## Architecture and logic review

Before automated verification, apply both `devclaw-architecture` and `review-devclaw` to the changes being verified. This is a required review, including before a commit; successful automated checks do not replace it.

- Establish the exact scope from the request and Git diff. Inspect relevant tracked changes and the contents of intended untracked files; preserve unrelated user changes.
- Review architecture and behavior together where practical. Follow only the callers, schemas, APIs, and persistence contracts needed to assess the changed behavior; do not audit the entire repository by default.
- Scale depth to risk. A local type extraction or documentation edit needs a brief contract and consistency check. Changes to persistence, locks, retries, delivery, public APIs, or package ownership require the relevant failure, concurrency, and recovery analysis.
- Reuse skills and package contracts already read in this session when their current contents are known and unchanged. Reuse review evidence for unchanged code; inspect subsequent edits and their affected assumptions instead of repeating the entire review. A previous test pass alone is not review evidence.
- Close actionable in-scope findings before declaring verification complete. If fixing them is already authorized by the implementation task, fix and review the affected changes. Otherwise report the blocker without modifying code or seeking redundant approval.
- Keep the review summary concise: scope, findings, evidence, and unresolved limitations. Do not repeat full checklists or generate a separate review artifact unless requested.

## Automated checks

Run these checks in order and stop at the first failure:

1. `npm run arch:check:strict`
2. `npm run check`
3. `npm run build`
4. `npm run test`
5. `git diff --check`
6. `git status --short`

On Windows PowerShell, use `npm.cmd` instead of `npm` when the execution policy blocks `npm.ps1`.

## Failure handling

- Diagnose the underlying failure before changing code.
- Fix failures only when the current task authorizes implementation. For review-only requests, report the failure without modifying files.
- Do not disable or weaken TypeScript, ESLint, architecture, build, or test checks.
- Re-run the failed check after a fix, then continue through the remaining checks.
- Preserve unrelated user changes and generated artifacts already present before verification.

## Commit contents

When a commit is authorized, inspect `git diff --cached --name-status`, the staged diff, and `git diff --cached --check` after staging and before committing. Confirm that every staged file belongs to the requested change, contains the reviewed content, follows the architecture rules, and excludes local coordination state and unintended generated files. Compare the staged content with the verified working tree, including partially staged files. Do not commit unreviewed differences or claim checks cover different content; review and rerun relevant checks if the intended snapshot changed.

This gate does not authorize staging or committing by itself. If no commit is requested, report the intended scope and remaining changes without staging them.

## Reporting

Report:

- the architecture and logic review scope, including reused evidence and any remaining findings;
- every automated check that passed or failed;
- test suite and test case totals when available;
- the first actionable failure with its file and cause;
- remaining modified, staged, and untracked files;
- whether verification itself changed the working tree;
- the result of the staged-content review when a commit is requested.

Do not stage, commit, amend, or push unless the user explicitly requests that separate action.
