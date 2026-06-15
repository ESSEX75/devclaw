# Step-Based Task Model

Historical design notes for hierarchical issue → step layering. Current sprint-mode MVP uses rolling sprint branches, not branch chaining between child issues.

**Related:** [#443 — Dependency gating](https://github.com/laurentenhoor/devclaw/issues/443)

---

## Problem

Today, DevClaw treats every GitHub issue as an atomic unit of work. One issue = one developer dispatch = one PR = one review cycle. This breaks down for multi-step features:

1. **No decomposition inside an issue.** An architect creates separate issues for each implementation task, but there's no parent-child relationship or ordering. They float independently.
2. **No sequential gating.** All "To Do" issues are eligible for pickup simultaneously. If step 2 depends on step 1's code, the step-2 developer works against stale main and produces conflicts or incorrect code.
3. **No branch coordination.** Each PR targets the project base branch independently. Sequential sprint work needs child PRs to target a shared sprint branch so the developer sees prior merged sprint work.
4. **No progress tracking.** There's no way to see "feature X is 3/5 steps done" at the issue level.

---

## Design Goals

- **Issue → Step hierarchy** using GitHub sub-issues as the native substrate
- **Sequential by default** — steps dispatch in order; step N+1 is blocked until step N completes
- **Rolling sprint branch** — each step's PR targets the sprint branch, and the final PR targets the project base branch
- **Visible progress** — parent issue shows step completion as a checklist, updated by the pipeline
- **Backward compatible** — standalone issues (no parent) continue to work exactly as today

---

## Concepts

### Root Issue (Epic)

A regular GitHub issue that has sub-issues. DevClaw doesn't dispatch root issues directly — it dispatches their steps. The root issue serves as:

- The user-facing "feature ticket"
- A progress dashboard (auto-updated checklist in the body)
- The anchor for notifications and status queries

Root issues stay in **Planning** state and are closed automatically when all steps reach Done.

### Step (Sub-Issue)

A GitHub sub-issue of a root issue. Each step is a regular issue that flows through the normal workflow (To Do → Doing → To Review → Done). Steps have:

- A **sequence number** derived from their position in the parent's sub-issue list (GitHub sub-issues are ordered)
- A **dependency** on the previous step (sequential mode) or no dependency (parallel mode)
- Their own PR, branch, and worker assignment

### Execution Modes

| Mode | Behavior | Use case |
|---|---|---|
| `sequential` (default) | Step N+1 is blocked until step N reaches Done | Feature implementation where each step builds on the last |
| `parallel` | All steps are eligible for pickup simultaneously | Independent refactoring tasks grouped under one epic |

The mode is set on the root issue via a label: `steps:sequential` (default) or `steps:parallel`.

---

## Data Model

### GitHub Sub-Issues as Steps

GitHub's sub-issues feature (GA since 2025) provides:

- Parent-child relationships via GraphQL API (`addSubIssue` / `removeSubIssue` mutations)
- Ordered list (repositionable via `reprioritizeSubIssue`)
- Up to 100 sub-issues per parent, 8 levels of nesting
- Visible in the issue UI as a collapsible checklist

This means we don't need our own step storage — GitHub IS the database. The sub-issue order defines the execution sequence.

### Labels

| Label | Applied to | Purpose |
|---|---|---|
| `epic` | Root issue | Marks an issue as a step container (not directly dispatchable) |
| `steps:sequential` | Root issue | Steps execute in order (default, can be omitted) |
| `steps:parallel` | Root issue | Steps execute independently |
| `step:{N}` | Step issue | Position in sequence (e.g. `step:1`, `step:2`) — set automatically |
| `blocked:step` | Step issue | Step is waiting for a predecessor to complete |

Existing labels (`To Do`, `Doing`, `developer:senior:Ada`, etc.) continue to work on step issues exactly as they do on standalone issues.

### Provider Interface Extensions

```typescript
// New methods on IssueProvider
interface IssueProvider {
  // ... existing methods ...

  /** List sub-issues of a parent issue, in order. */
  listSubIssues(parentId: number): Promise<SubIssue[]>;

  /** Add an existing issue as a sub-issue of a parent. */
  addSubIssue(parentId: number, childId: number): Promise<void>;

  /** Get the parent issue ID for a sub-issue, or null if standalone. */
  getParentIssue(issueId: number): Promise<number | null>;
}

type SubIssue = {
  iid: number;
  title: string;
  state: string;       // "open" | "closed"
  labels: string[];
  position: number;     // 0-indexed order in parent's list
};
```

The GitHub provider implements these via GraphQL with the `GraphQL-Features: sub_issues` header. The GitLab provider can use linked issues with `blocks`/`is_blocked_by` relationships as a fallback.

---

## Dispatch Changes

### Queue Scan (tick.ts)

When `findNextIssueForRole` finds a queued issue, add a dependency check before dispatch:

```
1. Find issue in queue (existing logic)
2. NEW: Check if issue has a parent (getParentIssue)
3. If parent exists AND parent has `steps:sequential` (or no steps: label):
   a. List all sub-issues of parent (listSubIssues)
   b. Find this issue's position in the list
   c. Check if ALL preceding steps are in a terminal state (Done/Rejected)
   d. If not → skip issue, apply `blocked:step` label, continue scanning
   e. If yes → remove `blocked:step` label if present, proceed with dispatch
4. If parent has `steps:parallel` or issue has no parent → dispatch normally
```

This also satisfies issue #443's core requirement (dependency gating) for the sub-issue case.

### Branch Targeting

When a developer is dispatched for a sprint child:

1. Read `sprintBranch` from `devclaw/sprints.json`
2. Include the branch contract in the task message:
   ```
   BASE BRANCH: main
   PR TARGET BRANCH: sprint/42-auth
   ```
3. The developer creates their PR/MR against the sprint branch

After all child work is merged into the sprint branch, DevClaw creates a final PR/MR from `sprintBranch` to `project.baseBranch`.

### Pipeline Completion (pipeline.ts)

When a step completes (reaches Done):

1. **Update parent progress** — Edit the root issue body to tick off the completed step
2. **Unblock next step** — If sequential mode:
   - Find the next sub-issue in order
   - Remove `blocked:step` label
   - If it's in `Planning`, transition to `To Do` (auto-queue)
   - The next heartbeat tick will pick it up
3. **Close parent when done** — If all sub-issues are in terminal states, close the root issue and transition its label to `Done`

---

## Creating Steps

### Option A: Manual (User Creates Sub-Issues)

User creates a root issue, then adds sub-issues via GitHub UI or CLI. They apply the `epic` label to the root. DevClaw discovers the structure during queue scan.

### Option B: Architect-Driven (Automated)

Extend `research_task` or add a new `plan_task` tool:

```
plan_task({
  title: "Add user authentication",
  description: "...",
  steps: [
    { title: "Set up auth middleware", description: "..." },
    { title: "Add login/register endpoints", description: "..." },
    { title: "Add JWT token refresh", description: "..." },
    { title: "Add password reset flow", description: "..." },
  ]
})
```

This would:
1. Create the root issue with `epic` + `steps:sequential` labels
2. Create each step as a sub-issue (via `addSubIssue` mutation)
3. Apply `step:N` labels and queue the first step as `To Do`
4. Remaining steps get `Planning` + `blocked:step` labels

### Option C: Architect Decomposes (Hybrid)

The architect role receives a research task, investigates, and instead of creating independent `task_create` issues, uses a new `plan_steps` tool that creates them as sub-issues of a root issue. This keeps the human-in-the-loop for the initial research while automating the decomposition.

---

## Progress Tracking

### Root Issue Body (Auto-Updated)

The pipeline updates the root issue body with a progress section:

```markdown
## Steps

- [x] #101 Set up auth middleware — Done
- [ ] #102 Add login/register endpoints — Doing (developer:senior:Ada)
- [ ] #103 Add JWT token refresh — Blocked (waiting for #102)
- [ ] #104 Add password reset flow — Planning
```

Updated by `pipeline.ts` after each step completion. Uses `provider.editIssue()` to append/update the steps section.

### Status Tool

Extend `project_status` / `task_list` to show step hierarchy:

```
#100 Add user authentication [epic, 1/4 done]
  ├─ #101 Set up auth middleware        [Done]
  ├─ #102 Add login/register endpoints  [Doing → Ada]
  ├─ #103 Add JWT token refresh         [Blocked]
  └─ #104 Add password reset flow       [Planning]
```

### Notifications

Step completion notifications include parent context:

```
✅ DEVELOPER DONE #102 — Login endpoints implemented
📋 Issue #102 (step 2/4 of #100: Add user authentication)
🔗 PR
📊 Progress: 2/4 steps complete
⏭️ Next: #103 Add JWT token refresh (auto-queued)
```

---

## PR Stack Lifecycle

### Happy Path

```
Step 1: feat/101-auth-middleware     → PR #201 (base: main)
Step 2: feat/102-login-endpoints     → PR #202 (base: sprint/100-auth)
Step 3: feat/103-jwt-refresh         → PR #203 (base: sprint/100-auth)
```

1. PR #201 reviewed + merged into `sprint/100-auth`
2. PR #202 reviewed + merged into `sprint/100-auth`
3. PR #203 reviewed + merged into `sprint/100-auth`
4. Final PR from `sprint/100-auth` to the project base branch is reviewed or auto-merged according to policy
5. Root issue #100 auto-closes after final merge succeeds

### Conflict Handling

If retargeting causes conflicts:
- Heartbeat detects `mergeable: false` on the PR
- Transitions step to `To Improve`
- Developer is dispatched to rebase/resolve
- After fix, normal review cycle continues

### Review Order

Reviews follow step order naturally — step 1's PR is ready for review first, step 2's PR becomes reviewable only after its graph dependencies are merged.

For `steps:parallel` mode, child PRs can target the same sprint branch once their graph dependencies are clear.

---

## Implementation Plan

### Phase 1: Sub-Issue Discovery + Dependency Gating

**Scope:** Read-only sub-issue awareness. No new tools; branch chaining remains deferred.

1. Add `listSubIssues` and `getParentIssue` to `IssueProvider` interface
2. Implement in GitHub provider via GraphQL (with `sub_issues` feature header)
3. Add dependency check in `tick.ts` — skip issues whose predecessors aren't done
4. Add `blocked:step` label management
5. Extend `task_list` to show parent-child relationships

**Validates:** Core gating logic works. Covers #443 for the sub-issue case.

### Phase 2: Step Creation + Progress Tracking

**Scope:** Tools to create step hierarchies, auto-progress updates.

1. Add `addSubIssue` to provider interface + GitHub implementation
2. Create `plan_task` tool (or extend `task_create` with `parentId` parameter)
3. Add progress section auto-update in `pipeline.ts` after step completion
4. Auto-close root issue when all steps are terminal
5. Auto-queue next step on predecessor completion

### Phase 3: PR Stacking

**Scope:** Stacked PRs for sequential steps.

1. On dispatch of step N>1, look up step N-1's branch name via `getPrStatus`
2. Include base branch override in task message
3. Extend `work_finish` validation to check PR targets correct base
4. Handle retarget-after-merge (GitHub does this automatically)
5. Handle conflicts after retarget (heartbeat detects, transitions to `To Improve`)

### Phase 4: Parallel Mode + Polish

**Scope:** Support `steps:parallel`, improve UX.

1. Respect `steps:parallel` label — skip dependency check, PRs target `main`
2. Enhanced notifications with progress context
3. Status dashboard shows step trees
4. Circular dependency detection (for future general dependency gating beyond sub-issues)

---

## Open Questions

1. **GitLab support.** GitLab doesn't have sub-issues in the same way. Options: linked issues with `blocks` relation, or a separate tracking mechanism (issue body checklist + convention). Phase 1 could be GitHub-only with a GitLab adapter later.

2. **Partial stacks.** What if step 2's PR is approved before step 1? Should we hold the merge, or merge into the stack branch and let it cascade? Recommendation: hold — only merge when base is `main` (i.e., all predecessors are merged).

3. **Re-ordering steps.** If a user reorders sub-issues on GitHub mid-flight, should DevClaw respect the new order? Recommendation: yes, with a warning if in-progress steps would be affected.

4. **Max stack depth.** Very deep stacks (10+ PRs) can be unwieldy. Should we warn or cap? Recommendation: warn at 5+, no hard cap.

5. **`plan_task` vs extending `research_task`.** The architect already creates implementation tasks. Should `plan_task` be a separate tool, or should `research_task` gain a `createAsSteps` option? Recommendation: separate tool — clearer intent, and `plan_task` doesn't need a research phase.

6. **General dependency gating (#443).** This design covers the sub-issue sequential case. Issue #443 also asks for cross-issue dependencies (issue B depends on issue A, where A is not a sub-issue of B). That could be a separate mechanism using GitHub's issue dependency feature (`is blocked by`) — complementary to this design but independent.

---

## Rejected Alternatives

### Task lists in issue body (checkbox markdown)

Using `- [ ] Step 1` in the issue body as the step definition. Rejected because:
- No individual issue for each step (no labels, no PR linking, no separate lifecycle)
- Parsing markdown checklists is fragile
- Can't dispatch work to a checkbox

### Custom step storage in `projects.json`

Tracking steps in local state. Rejected because:
- Violates the "GitHub is the database" principle
- State divergence between local storage and GitHub
- Loses the benefits of GitHub's sub-issue UI

### Monorepo-style branch chains

Full branch-chain tools that rewrite commit history. Rejected because:
- Over-engineered for our sequential-step use case
- Requires complex rebase automation
- Rolling sprint branches cover the MVP without provider-specific retarget automation

---

## References

- [GitHub Sub-Issues announcement](https://github.blog/engineering/architecture-optimization/introducing-sub-issues-enhancing-issue-management-on-github/)
- [GitHub Sub-Issues API (GraphQL)](https://docs.github.com/en/graphql/reference/mutations#addsubissue) — requires `GraphQL-Features: sub_issues` header
- [Issue #443 — Dependency gating](https://github.com/laurentenhoor/devclaw/issues/443)
