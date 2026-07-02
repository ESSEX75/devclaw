# Workflow Alternatives: How to Model Steps

Comparing approaches for issue → step layering with sequential execution, testability, and PR management.

---

## What We Need

1. **Define steps** inside a larger unit of work
2. **Enforce sequential execution** (step N+1 blocked until step N done)
3. **Plan testing** as a step, not just a default pipeline phase
4. **Each code step produces a PR** with standard lifecycle (review, merge, conflicts)
5. **Track progress** (3/5 steps done)
6. **Work across GitHub and GitLab**

---

## The Five Approaches

### A. Markdown Plan in Issue Body

Steps defined as structured content in the issue description. The issue IS the plan.

```markdown
## Plan

| # | Step | Role | Status |
|---|------|------|--------|
| 1 | Set up auth middleware | developer | ✅ Done — PR #201 |
| 2 | Add login endpoints | developer | 🔄 Doing (Ada) |
| 3 | Write integration tests | tester | ⏳ Blocked |
| 4 | Update API docs | developer | ⏳ Blocked |
```

**How dispatch works:** DevClaw parses the plan section, finds the first non-done step, dispatches a worker for that step. The worker gets the full issue context plus "You are working on step 2: Add login endpoints." When the step completes, DevClaw updates the plan table.

**How PRs work:** Each step creates a branch: `feat/100-step-2-login`. Multiple PRs reference the same issue (#100). DevClaw tracks which PR belongs to which step by branch naming convention.

| Dimension | Assessment |
|---|---|
| Sequential enforcement | Trivial — iterate the list, find first undone |
| Testing as a step | Step 3 has `role: tester` — dispatches a tester |
| PR lifecycle | Multiple PRs per issue (new pattern). PR-to-step mapping via branch naming |
| Progress tracking | The plan table IS the progress view |
| GitHub/GitLab | Works everywhere — just markdown |
| Step-level discussion | Awkward — all comments on one issue thread, need to tag which step |
| Step-level labels | Not possible — one issue has one set of labels |
| Overhead | Low — no extra issues created |
| Fragility | Medium — markdown parsing, user could break format |

**Biggest advantage:** Zero API dependencies, works on any tracker, single issue per feature.

**Biggest risk:** Multiple PRs per issue breaks the current 1:1 issue↔PR assumption throughout the codebase. And step-level labels don't work (one issue = one label set, so you can't have step 1 "Done" and step 2 "Doing" simultaneously).

---

### B. Sub-Issues (Native Hierarchy)

Each step is a real child issue. GitHub sub-issues or GitLab work items.

```
#100 Add user authentication [epic]
  ├─ #101 Set up auth middleware     [Done]
  ├─ #102 Add login endpoints        [Doing]
  ├─ #103 Write integration tests    [Blocked]
  └─ #104 Update API docs            [Blocked]
```

**How dispatch works:** Queue scanner finds #102 in "To Do", checks parent #100 for step ordering, verifies #101 is done, dispatches #102. Standard issue lifecycle per step.

**How PRs work:** One PR per step issue (existing pattern). PR stacking: #102's PR targets #101's branch.

| Dimension | Assessment |
|---|---|
| Sequential enforcement | Check sibling sub-issues' states before dispatch |
| Testing as a step | #103 is a tester issue with `To Test` label |
| PR lifecycle | One PR per issue — existing pattern, no changes |
| Progress tracking | GitHub sub-issue UI shows checklist natively |
| GitHub/GitLab | GitHub: sub-issues API (GA). GitLab: WorkItem API (maturing) |
| Step-level discussion | Each step has its own comment thread |
| Step-level labels | Each step has its own labels (Doing, developer:senior) |
| Overhead | High — 1 root + N step issues per feature |
| Fragility | Low for GitHub; medium for GitLab (API gaps) |

**Biggest advantage:** Full lifecycle per step. No changes to the PR model. Labels, comments, assignees all work naturally per step.

**Biggest risk:** API dependency on GitHub sub-issues (needs special GraphQL header) and GitLab work items (API still maturing). Creates many issues.

---

### C. Issue Type Labels + Cross-References

Regular issues with type labels (`plan`, `step`) and references linking them.

```
#100 Add user authentication           [label: plan]
#101 Set up auth middleware             [label: step, step:1, parent:100]
#102 Add login endpoints               [label: step, step:2, parent:100]
#103 Write integration tests            [label: step, step:3, parent:100]
```

**How dispatch works:** Queue scanner finds step issues, reads `step:N` and `parent:X` labels, fetches sibling steps by label query, checks ordering.

**How PRs work:** One PR per step issue (standard).

| Dimension | Assessment |
|---|---|
| Sequential enforcement | Query all issues with `parent:100`, sort by `step:N`, check predecessors |
| Testing as a step | #103 has `step` + appropriate queue label |
| PR lifecycle | Standard — one PR per issue |
| Progress tracking | Query all steps of a parent, count done vs. total |
| GitHub/GitLab | Works everywhere — labels are universal |
| Step-level discussion | Each step has own comments |
| Step-level labels | Full label support per step |
| Overhead | Same as B (N+1 issues) but no API dependency for hierarchy |
| Fragility | Medium — relies on label conventions, no native hierarchy enforcement |

**Biggest advantage:** No special API needed. Works on any issue tracker today. Labels are the universal primitive.

**Biggest risk:** Labels are convention-based — nothing prevents `step:3` without `parent:X`. No native UI for the hierarchy. Ordering via label values is fragile (label `step:10` sorts before `step:2` lexicographically).

---

### D. Plan Files in DevClaw Data Directory

A YAML file in the workspace defines the plan. Issues are created on demand per step.

```yaml
# devclaw/projects/my-app/plans/100.yaml
issue: 100
title: Add user authentication
mode: sequential
steps:
  - title: Set up auth middleware
    role: developer
    status: done
    issue: 101
    pr: 201
  - title: Add login endpoints
    role: developer
    status: doing
    issue: 102
  - title: Write integration tests
    role: tester
    status: blocked
  - title: Update API docs
    role: developer
    status: pending
```

**How dispatch works:** DevClaw reads the plan file, finds the first non-done step, creates a step issue if it doesn't exist yet, dispatches. Plan file is the source of truth for ordering; issue tracker is the execution surface.

**How PRs work:** One PR per step issue (standard).

| Dimension | Assessment |
|---|---|
| Sequential enforcement | Trivial — read YAML list, find first non-done |
| Testing as a step | Step with `role: tester` dispatches to tester queue |
| PR lifecycle | Standard — one PR per step issue |
| Progress tracking | Read plan file. Also update root issue body for visibility |
| GitHub/GitLab | Identical — plan file is provider-agnostic |
| Step-level discussion | Each step gets an issue when created |
| Step-level labels | Full label support per step issue |
| Overhead | Plan file + issues created on demand (lazy) |
| Fragility | Low (Zod-validated YAML). But state can diverge from issue tracker |

**Biggest advantage:** Full control, provider-agnostic, Zod-validated, trivial sequential enforcement. Issues created lazily — only step 1 needs an issue right away.

**Biggest risk:** Two sources of truth. Plan file says step 2 is "blocked" but someone manually moves the issue to "To Do" on GitHub. Sync becomes the hard problem.

---

### E. Plan File in the Worktree/Repo

A `.devclaw/plan.yaml` committed to the repo, versioned with the code.

| Dimension | Assessment |
|---|---|
| Sequential enforcement | Same as D |
| Testing as a step | Same as D |
| PR lifecycle | Plan file changes with each step PR (merge conflicts between steps!) |
| Progress tracking | Git log shows plan evolution |
| GitHub/GitLab | Provider-agnostic |
| Step-level discussion | Same as D |
| Overhead | Plan lives in repo — every step PR modifies it |
| Fragility | High — plan file in repo creates merge conflicts between concurrent step PRs |

**Biggest advantage:** Version-controlled plan, visible in code review.

**Biggest risk:** Plan file is in the repo, so step 2's PR modifies it, and step 3's PR also modifies it → merge conflict on the plan file itself. This makes it incompatible with PR stacking.

**Verdict: E is eliminated.** Plan files in the repo conflict with the PR stacking model.

---

## Comparison Matrix

| | A: Markdown body | B: Sub-issues | C: Type labels | D: Plan file |
|---|---|---|---|---|
| **Sequential enforcement** | ✅ Easy (parse list) | ✅ Check siblings | ⚠️ Label queries | ✅ Read YAML |
| **Testing as a step** | ✅ Role per step | ✅ Step issue in test queue | ✅ Step issue in test queue | ✅ Role in plan |
| **PR model** | ⚠️ Multi-PR per issue (new) | ✅ 1:1 (existing) | ✅ 1:1 (existing) | ✅ 1:1 (lazy issue creation) |
| **PR stacking** | ⚠️ Complex (which PR is which step?) | ✅ Natural (step N-1 branch) | ✅ Same as B | ✅ Same as B |
| **Progress visibility** | ✅ In issue body | ✅ Native sub-issue UI | ⚠️ Label count query | ⚠️ File (+ sync to issue body) |
| **Step labels/comments** | ❌ Shared issue | ✅ Per step | ✅ Per step | ✅ Per step (when created) |
| **GitHub support** | ✅ Universal | ✅ Sub-issues API (GA) | ✅ Universal | ✅ Universal |
| **GitLab support** | ✅ Universal | ⚠️ WorkItem API (maturing) | ✅ Universal | ✅ Universal |
| **Issue overhead** | ✅ 1 issue | ⚠️ N+1 issues | ⚠️ N+1 issues | ✅ 1 + N on demand |
| **Single source of truth** | ✅ Issue body | ✅ Issue tracker | ⚠️ Label convention | ❌ File + tracker |
| **Fragility** | ⚠️ Markdown parsing | ✅ Structured API | ⚠️ Convention-based | ⚠️ State divergence |
| **Code changes** | 🔴 Large (multi-PR/issue) | 🟡 Medium (provider ext) | 🟢 Small (label logic) | 🟡 Medium (file layer + sync) |

---

## Recommendation: C+D Hybrid — Label Conventions + Local Plan

**Use labels as the universal hierarchy mechanism (C), with a local plan file as the orchestration layer (D).**

### Why this combination

**Labels solve the provider problem.** Every issue tracker has labels. No special API needed for GitHub sub-issues or GitLab work items. The hierarchy is expressed through `plan:100` and `step:1` labels on regular issues.

**Plan file solves the ordering problem.** Sequential enforcement is trivial with a YAML file — no label sorting hacks, no API queries to find siblings. The plan file is the authoritative ordering, validated with Zod.

**Issues are the execution surface.** Each step gets a real issue with full lifecycle (labels, PRs, comments, assignees). Issues are created lazily — only the next step needs an issue.

**Issue tracker stays visible.** The root issue body is auto-updated with progress (like approach A). People browsing GitHub see the plan and progress without needing access to the DevClaw workspace.

### How it works

```
devclaw/projects/my-app/plans/100.yaml     ← orchestration (ordering, deps, roles)
GitHub issue #100                           ← visibility (plan body, progress)
GitHub issue #101, #102, ...                ← execution (one per active/done step)
```

1. **`plan_task`** creates root issue + plan file. First step issue created immediately.
2. **Heartbeat** reads plan file, checks if current step is done, creates next step issue, dispatches.
3. **Pipeline** updates plan file on step completion, updates root issue body, creates next step issue.
4. **Sync** is one-directional: plan file → issue tracker. Never the reverse. Plan file is authoritative.

### The sync problem (and solution)

The risk with D was "state divergence." Solved by making the plan file **write-only from DevClaw's perspective** and the issue tracker **read-only for hierarchy**:

- DevClaw reads the plan file for ordering/deps.
- DevClaw reads the issue tracker for step status (Done/Doing/etc. from labels).
- DevClaw writes to the plan file when creating/completing steps.
- DevClaw writes to the issue tracker for label transitions, issue creation, body updates.
- Humans never edit the plan file. They interact with issues on GitHub/GitLab.

If someone manually moves a step issue to "Done" on GitHub, the heartbeat detects the label change and updates the plan file accordingly. One-way sync from tracker to plan for status; one-way from plan to tracker for ordering.

### Where sub-issues fit

Sub-issues (B) become an **enhancement, not a requirement**:

- If GitHub sub-issues API is available, use it to create the parent-child relationship (better UI).
- If not (GitLab, older GitHub), fall back to label-based hierarchy (`plan:100` labels).
- The plan file handles ordering regardless. Sub-issues are just visual sugar.

---

## Step Definition Format (Plan File)

```yaml
# devclaw/projects/<project>/plans/<rootIssueId>.yaml
root: 100                    # Root issue number
title: Add user authentication
mode: sequential             # sequential | parallel
created: 2026-03-01T10:00:00Z
steps:
  - id: 1
    title: Set up auth middleware
    role: developer
    review: human             # human | agent | skip (overrides project default)
    issue: 101                # populated when step issue is created
    status: done              # pending | active | done | skipped
  - id: 2
    title: Add login endpoints
    role: developer
    issue: 102
    status: active
  - id: 3
    title: Write integration tests
    role: tester
    review: skip              # test steps don't need PR review
    status: pending
  - id: 4
    title: Update API docs
    role: developer
    review: skip
    status: pending
```

### What's in the plan file vs. what's on the issue

| Data | Plan file | Issue tracker |
|---|---|---|
| Step ordering | ✅ Authoritative | Display only (body checklist) |
| Step dependencies | ✅ Authoritative | Labels (`blocked:step`) |
| Step status | Derived from issue labels | ✅ Authoritative |
| Step role | ✅ Authoritative | Inferred from queue state |
| Review policy per step | ✅ Authoritative | Applied as label on dispatch |
| PR URL | Cached | ✅ Authoritative |
| Root issue progress | Rendered from plan | ✅ Displayed in body |

---

## Testing: Step vs. Phase

### Testing as a Step (planned)

```yaml
steps:
  - id: 1
    title: Implement feature
    role: developer
  - id: 2
    title: Write and run tests
    role: tester
    review: skip
```

- Explicit. Only issues that need testing get it.
- Tester gets dispatched as step 2 with full context of what step 1 did.
- The tester step issue goes through: To Test → Testing → Done/Fail.
- If fail, the tester step goes to To Improve and a developer fixes it.

### Testing as a Phase (default workflow)

```yaml
workflow:
  testPolicy: agent
```

- Implicit. ALL issues in the project get tested after PR merge.
- Tester has no context of the plan — just reviews the PR.
- Applied at the project level, not per-issue.

### Coexistence

- Simple standalone issues use the phase-level `testPolicy`.
- Planned issues with explicit test steps skip the phase-level test (the plan overrides).
- The plan file's `review` and `test` fields per step override project-level policies.

---

## Impact on Existing Architecture

### What changes

| Component | Change |
|---|---|
| `IssueProvider` | No new methods required (labels only) |
| `tick.ts` (queue scanner) | Check plan file before dispatch — skip blocked steps |
| `pipeline.ts` (completion) | On step done: update plan file, create next step issue, update root body |
| `plan_task` tool (new) | Creates root issue + plan file + first step issue |
| Plan file I/O (new) | Read/write YAML in `devclaw/projects/<project>/plans/` |
| `task_list` | Show hierarchy from plan files |
| `project_status` | Show active plans with progress |
| Heartbeat | Read plan files, check if next step should be queued |
| Notifications | Include plan context (step 2/4 of #100) |

### What doesn't change

| Component | Why |
|---|---|
| Dispatch (`dispatch/index.ts`) | Still dispatches issues. Step issues are normal issues. |
| Worker tools (`work_finish`) | Workers don't know about plans. They finish an issue. |
| Session management | Same session model. One session per worker slot. |
| Role registry | Same roles. Plan just assigns roles to steps. |
| PR lifecycle | Same. One PR per step issue. Review/merge/conflict handling unchanged. |
| Config (`workflow.yaml`) | No new keys. Plan overrides per-step, not per-project. |
| Bootstrap hook | Same role prompts. Step context added to task message (Layer 4). |

---

## Open Questions

1. **Can a step fail and retry?** If a tester step fails, does the tester re-run, or does a developer step get inserted before it? Recommendation: tester step transitions to To Improve (developer fixes), then back to tester. Same as current workflow within a step.

2. **Can steps be added mid-flight?** User realizes they need an extra step after step 2. Recommendation: yes — append to plan file, update root issue body.

3. **Can steps be reordered mid-flight?** Recommendation: only pending steps can be reordered. Active/done steps are locked.

4. **Parallel sub-groups within sequential steps?** E.g., steps 2a and 2b run in parallel, then step 3 waits for both. Recommendation: out of scope for v1. Sequential only. Future enhancement.

5. **What triggers plan creation?** Options: (a) `plan_task` tool called by human/orchestrator, (b) architect creates plan as output of `research_task`, (c) both. Recommendation: both.
