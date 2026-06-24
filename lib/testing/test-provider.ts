/**
 * TestProvider — In-memory IssueProvider for integration tests.
 *
 * Tracks all method calls for assertion. Issues are stored in a simple map.
 * No external dependencies — pure TypeScript.
 */
import type {
  IssueProvider,
  Issue,
  StateLabel,
  IssueComment,
  PrStatus,
  SprintBranch,
  SprintDependency,
  SprintMilestone,
  SprintPullRequest,
  SprintProviderCapabilities,
  SprintReadinessCheck,
  SprintTree,
  ManagedProjectionGuardResult,
} from "../providers/provider.js";
import { getStateLabels } from "../workflow/index.js";
import { DEFAULT_WORKFLOW, type WorkflowConfig } from "../workflow/index.js";

// ---------------------------------------------------------------------------
// Call tracking
// ---------------------------------------------------------------------------

export type ProviderCall =
  | { method: "ensureLabel"; args: { name: string; color: string } }
  | { method: "ensureAllStateLabels"; args: {} }
  | {
      method: "createIssue";
      args: {
        title: string;
        description: string;
        label: StateLabel;
        assignees?: string[];
      };
    }
  | { method: "listIssuesByLabel"; args: { label: StateLabel } }
  | { method: "listIssues"; args: { label?: string; state?: string } }
  | { method: "getIssue"; args: { issueId: number } }
  | { method: "listComments"; args: { issueId: number } }
  | {
      method: "transitionLabel";
      args: { issueId: number; from: StateLabel; to: StateLabel };
    }
  | { method: "addLabel"; args: { issueId: number; label: string } }
  | { method: "removeLabels"; args: { issueId: number; labels: string[] } }
  | { method: "closeIssue"; args: { issueId: number } }
  | { method: "reopenIssue"; args: { issueId: number } }
  | { method: "getMergedMRUrl"; args: { issueId: number } }
  | { method: "getPrStatus"; args: { issueId: number } }
  | { method: "mergePr"; args: { issueId: number } }
  | { method: "getPrDiff"; args: { issueId: number } }
  | { method: "getPrReviewComments"; args: { issueId: number } }
  | { method: "getSprintCapabilities"; args: {} }
  | { method: "checkSprintReadiness"; args: { baseBranch: string; reviewPolicy?: string } }
  | { method: "createSprintMilestone"; args: { title: string; description?: string } }
  | { method: "createSprintRoot"; args: { title: string; body: string; milestoneId?: string; labels?: string[]; assignees?: string[] } }
  | { method: "createChildIssue"; args: { title: string; body: string; milestoneId?: string; labels?: string[]; assignees?: string[] } }
  | { method: "linkChildIssue"; args: { rootIssueId: number; childIssueId: number } }
  | { method: "linkIssueDependency"; args: { blockedIssueId: number; blockingIssueId: number } }
  | { method: "assignIssue"; args: { issueId: number; assignees: string[] } }
  | { method: "createSprintBranch"; args: { branch: string; fromBranch: string } }
  | { method: "createWorkBranch"; args: { branch: string; fromBranch: string } }
  | { method: "createPullRequest"; args: { title: string; body: string; sourceBranch: string; targetBranch: string; issueId?: number } }
  | { method: "linkPullRequestToIssue"; args: { issueId: number; pullRequestId: string; pullRequestUrl: string } }
  | { method: "readSprintTree"; args: { rootIssueId: number } }
  | { method: "readDependencies"; args: { issueIds: number[] } }
  | { method: "closeSprintMilestone"; args: { milestoneId: string } }
  | { method: "guardManagedProjection"; args: { rootIssueId: number; expectedMetadata: Record<string, unknown>; repair?: boolean } }
  | { method: "addComment"; args: { issueId: number; body: string } }
  | { method: "editIssue"; args: { issueId: number; updates: { title?: string; body?: string } } }
  | { method: "healthCheck"; args: {} };

// ---------------------------------------------------------------------------
// TestProvider
// ---------------------------------------------------------------------------

export class TestProvider implements IssueProvider {
  /** All issues keyed by iid. */
  issues = new Map<number, Issue>();
  /** Comments per issue. */
  comments = new Map<number, IssueComment[]>();
  /** Labels that have been ensured. */
  labels = new Map<string, string>();
  /** PR status overrides per issue. Default: { state: "closed", url: null }. */
  prStatuses = new Map<number, PrStatus>();
  /** Merged MR URLs per issue. */
  mergedMrUrls = new Map<number, string>();
  /** Issue IDs where mergePr should fail (simulates merge conflicts). */
  mergePrFailures = new Set<number>();
  /** PR diffs per issue (for reviewer tests). */
  prDiffs = new Map<number, string>();
  /** All calls, in order. */
  calls: ProviderCall[] = [];
  /** Sprint projection stores for provider contract tests. */
  sprintMilestones = new Map<string, SprintMilestone & { closed?: boolean }>();
  sprintRootChildren = new Map<number, number[]>();
  sprintIssueMilestones = new Map<number, string>();
  sprintBranches = new Map<string, SprintBranch>();
  sprintDependencies: SprintDependency[] = [];
  sprintPullRequests = new Map<string, SprintPullRequest & { issueId?: number }>();
  managedProjectionErrors: string[] = [];
  /** Sprint capability overrides for readiness tests. */
  sprintCapabilities: SprintProviderCapabilities = {
    issues: true,
    milestones: true,
    branches: true,
    pullRequests: true,
    autoMerge: true,
    nativeSubIssues: false,
    nativeDependencies: false,
  };
  /** Sprint readiness failures/warnings for readiness tests. */
  sprintReadiness: {
    blocking: SprintReadinessCheck[];
    warnings: SprintReadinessCheck[];
  } = {
    blocking: [],
    warnings: [],
  };

  private nextIssueId = 1;
  private nextMilestoneId = 1;
  private nextPullRequestId = 1;
  private workflow: WorkflowConfig;

  constructor(opts?: { workflow?: WorkflowConfig }) {
    this.workflow = opts?.workflow ?? DEFAULT_WORKFLOW;
  }

  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  /** Create an issue directly in the store (bypasses createIssue tracking). */
  seedIssue(overrides: Partial<Issue> & { iid: number }): Issue {
    const issue: Issue = {
      iid: overrides.iid,
      title: overrides.title ?? `Issue #${overrides.iid}`,
      description: overrides.description ?? "",
      labels: overrides.labels ?? [],
      state: overrides.state ?? "opened",
      web_url:
        overrides.web_url ?? `https://example.com/issues/${overrides.iid}`,
    };
    this.issues.set(issue.iid, issue);
    if (issue.iid >= this.nextIssueId) this.nextIssueId = issue.iid + 1;
    return issue;
  }

  /** Set PR status for an issue (used by review pass tests). */
  setPrStatus(issueId: number, status: PrStatus): void {
    this.prStatuses.set(issueId, status);
  }

  /** Get calls filtered by method name. */
  callsTo<M extends ProviderCall["method"]>(
    method: M,
  ): Extract<ProviderCall, { method: M }>[] {
    return this.calls.filter((c) => c.method === method) as any;
  }

  /** Reset call tracking (keeps issue state). */
  resetCalls(): void {
    this.calls = [];
  }

  /** Full reset — clear everything. */
  reset(): void {
    this.issues.clear();
    this.comments.clear();
    this.labels.clear();
    this.prStatuses.clear();
    this.mergedMrUrls.clear();
    this.mergePrFailures.clear();
    this.prDiffs.clear();
    this.sprintMilestones.clear();
    this.sprintRootChildren.clear();
    this.sprintIssueMilestones.clear();
    this.sprintBranches.clear();
    this.sprintDependencies = [];
    this.sprintPullRequests.clear();
    this.managedProjectionErrors = [];
    this.calls = [];
    this.sprintCapabilities = {
      issues: true,
      milestones: true,
      branches: true,
      pullRequests: true,
      autoMerge: true,
      nativeSubIssues: false,
      nativeDependencies: false,
    };
    this.sprintReadiness = {
      blocking: [],
      warnings: [],
    };
    this.nextIssueId = 1;
    this.nextMilestoneId = 1;
    this.nextPullRequestId = 1;
  }

  // -------------------------------------------------------------------------
  // IssueProvider implementation
  // -------------------------------------------------------------------------

  async getSprintCapabilities(): Promise<SprintProviderCapabilities> {
    this.calls.push({ method: "getSprintCapabilities", args: {} });
    return this.sprintCapabilities;
  }

  async checkSprintReadiness(opts: { baseBranch: string; reviewPolicy?: string }): Promise<{
    blocking: SprintReadinessCheck[];
    warnings: SprintReadinessCheck[];
  }> {
    this.calls.push({
      method: "checkSprintReadiness",
      args: { baseBranch: opts.baseBranch, reviewPolicy: opts.reviewPolicy },
    });
    return {
      blocking: [...this.sprintReadiness.blocking],
      warnings: [...this.sprintReadiness.warnings],
    };
  }

  async createSprintMilestone(input: { title: string; description?: string }): Promise<SprintMilestone> {
    this.calls.push({ method: "createSprintMilestone", args: input });
    const id = String(this.nextMilestoneId++);
    const milestone = {
      id,
      title: input.title,
      url: `https://example.com/milestones/${id}`,
    };
    this.sprintMilestones.set(id, milestone);
    return milestone;
  }

  async createSprintRoot(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    this.calls.push({ method: "createSprintRoot", args: input });
    const issue = await this.createIssue(input.title, input.body, input.labels?.[0] ?? "sprint:root", input.assignees);
    issue.labels = [...new Set([...(input.labels ?? ["sprint:root"])])];
    if (input.milestoneId) this.sprintIssueMilestones.set(issue.iid, input.milestoneId);
    this.sprintRootChildren.set(issue.iid, []);
    return issue;
  }

  async createChildIssue(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    this.calls.push({ method: "createChildIssue", args: input });
    const issue = await this.createIssue(input.title, input.body, input.labels?.[0] ?? "sprint:child", input.assignees);
    issue.labels = [...new Set([...(input.labels ?? ["sprint:child"])])];
    if (input.milestoneId) this.sprintIssueMilestones.set(issue.iid, input.milestoneId);
    return issue;
  }

  async linkChildIssue(input: { rootIssueId: number; childIssueId: number }): Promise<void> {
    this.calls.push({ method: "linkChildIssue", args: input });
    const children = this.sprintRootChildren.get(input.rootIssueId) ?? [];
    if (!children.includes(input.childIssueId)) children.push(input.childIssueId);
    this.sprintRootChildren.set(input.rootIssueId, children);
  }

  async linkIssueDependency(input: { blockedIssueId: number; blockingIssueId: number }): Promise<void> {
    this.calls.push({ method: "linkIssueDependency", args: input });
    if (!this.sprintDependencies.some((dep) =>
      dep.blockedIssueId === input.blockedIssueId && dep.blockingIssueId === input.blockingIssueId
    )) {
      this.sprintDependencies.push({ ...input, native: this.sprintCapabilities.nativeDependencies });
    }
    await this.addComment(input.blockingIssueId, `DevClaw sprint projection: #${input.blockingIssueId} blocks #${input.blockedIssueId}`);
    await this.addComment(input.blockedIssueId, `DevClaw sprint projection: blocked by #${input.blockingIssueId}`);
  }

  async assignIssue(input: { issueId: number; assignees: string[] }): Promise<void> {
    this.calls.push({ method: "assignIssue", args: input });
  }

  async createSprintBranch(input: { branch: string; fromBranch: string }): Promise<SprintBranch> {
    this.calls.push({ method: "createSprintBranch", args: input });
    const branch = { name: input.branch, base: input.fromBranch };
    this.sprintBranches.set(input.branch, branch);
    return branch;
  }

  async createWorkBranch(input: { branch: string; fromBranch: string }): Promise<SprintBranch> {
    this.calls.push({ method: "createWorkBranch", args: input });
    const branch = { name: input.branch, base: input.fromBranch };
    this.sprintBranches.set(input.branch, branch);
    return branch;
  }

  async createPullRequest(input: {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
    issueId?: number;
  }): Promise<SprintPullRequest> {
    this.calls.push({ method: "createPullRequest", args: input });
    const id = String(this.nextPullRequestId++);
    const pr = {
      id,
      url: `https://example.com/pull/${id}`,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      issueId: input.issueId,
    };
    this.sprintPullRequests.set(id, pr);
    return pr;
  }

  async linkPullRequestToIssue(input: { issueId: number; pullRequestId: string; pullRequestUrl: string }): Promise<void> {
    this.calls.push({ method: "linkPullRequestToIssue", args: input });
    const pr = this.sprintPullRequests.get(input.pullRequestId);
    if (pr) pr.issueId = input.issueId;
  }

  async readSprintTree(input: { rootIssueId: number }): Promise<SprintTree> {
    this.calls.push({ method: "readSprintTree", args: input });
    const rootIssue = await this.getIssue(input.rootIssueId);
    const childIds = this.sprintRootChildren.get(input.rootIssueId) ?? [];
    const childIssues = childIds.map((id) => {
      const issue = this.issues.get(id);
      if (!issue) throw new Error(`Issue #${id} not found in TestProvider`);
      return issue;
    });
    const milestoneId = this.sprintIssueMilestones.get(input.rootIssueId);
    const milestone = milestoneId ? this.sprintMilestones.get(milestoneId) : undefined;
    const issueIds = [input.rootIssueId, ...childIds];
    return {
      milestone,
      rootIssue,
      childIssues,
      dependencies: this.sprintDependencies.filter((dep) =>
        issueIds.includes(dep.blockedIssueId) || issueIds.includes(dep.blockingIssueId),
      ),
      pullRequests: [...this.sprintPullRequests.values()].filter((pr) =>
        pr.issueId !== undefined && issueIds.includes(pr.issueId),
      ),
    };
  }

  async readDependencies(input: { issueIds: number[] }): Promise<SprintDependency[]> {
    this.calls.push({ method: "readDependencies", args: input });
    return this.sprintDependencies.filter((dep) =>
      input.issueIds.includes(dep.blockedIssueId) || input.issueIds.includes(dep.blockingIssueId),
    );
  }

  async closeSprintMilestone(input: { milestoneId: string }): Promise<void> {
    this.calls.push({ method: "closeSprintMilestone", args: input });
    const milestone = this.sprintMilestones.get(input.milestoneId);
    if (milestone) milestone.closed = true;
  }

  async guardManagedProjection(input: {
    rootIssueId: number;
    expectedMetadata: Record<string, unknown>;
    repair?: boolean;
  }): Promise<ManagedProjectionGuardResult> {
    this.calls.push({ method: "guardManagedProjection", args: input });
    if (this.managedProjectionErrors.length === 0) {
      return { ok: true, repaired: [], integrityErrors: [] };
    }
    if (input.repair) {
      const repaired = [...this.managedProjectionErrors];
      this.managedProjectionErrors = [];
      return { ok: true, repaired, integrityErrors: [] };
    }
    return { ok: false, repaired: [], integrityErrors: [...this.managedProjectionErrors] };
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    this.calls.push({ method: "ensureLabel", args: { name, color } });
    this.labels.set(name, color);
  }

  async ensureAllStateLabels(): Promise<void> {
    this.calls.push({ method: "ensureAllStateLabels", args: {} });
    const stateLabels = getStateLabels(this.workflow);
    for (const label of stateLabels) {
      this.labels.set(label, "#000000");
    }
  }

  async createIssue(
    title: string,
    description: string,
    label: StateLabel,
    assignees?: string[],
  ): Promise<Issue> {
    this.calls.push({
      method: "createIssue",
      args: { title, description, label, assignees },
    });
    const iid = this.nextIssueId++;
    const issue: Issue = {
      iid,
      title,
      description,
      labels: [label],
      state: "opened",
      web_url: `https://example.com/issues/${iid}`,
    };
    this.issues.set(iid, issue);
    return issue;
  }

  async listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    this.calls.push({ method: "listIssuesByLabel", args: { label } });
    return [...this.issues.values()].filter((i) => i.labels.includes(label));
  }

  async listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]> {
    this.calls.push({ method: "listIssues", args: { label: opts?.label, state: opts?.state } });
    let issues = [...this.issues.values()];
    if (opts?.label) issues = issues.filter((i) => i.labels.includes(opts.label!));
    if (opts?.state === "open") issues = issues.filter((i) => i.state === "opened" || i.state === "OPEN");
    else if (opts?.state === "closed") issues = issues.filter((i) => i.state === "closed" || i.state === "CLOSED");
    return issues;
  }

  async getIssue(issueId: number): Promise<Issue> {
    this.calls.push({ method: "getIssue", args: { issueId } });
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`Issue #${issueId} not found in TestProvider`);
    return issue;
  }

  async listComments(issueId: number): Promise<IssueComment[]> {
    this.calls.push({ method: "listComments", args: { issueId } });
    return this.comments.get(issueId) ?? [];
  }

  async transitionLabel(
    issueId: number,
    from: StateLabel,
    to: StateLabel,
  ): Promise<void> {
    this.calls.push({ method: "transitionLabel", args: { issueId, from, to } });
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`Issue #${issueId} not found in TestProvider`);
    // Remove all state labels, add the new one
    const stateLabels = getStateLabels(this.workflow);
    issue.labels = issue.labels.filter((l) => !stateLabels.includes(l));
    issue.labels.push(to);
  }

  async addLabel(issueId: number, label: string): Promise<void> {
    this.calls.push({ method: "addLabel", args: { issueId, label } });
    const issue = this.issues.get(issueId);
    if (issue && !issue.labels.includes(label)) {
      issue.labels.push(label);
    }
  }

  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    this.calls.push({ method: "removeLabels", args: { issueId, labels } });
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.labels = issue.labels.filter((l) => !labels.includes(l));
    }
  }

  async closeIssue(issueId: number): Promise<void> {
    this.calls.push({ method: "closeIssue", args: { issueId } });
    const issue = this.issues.get(issueId);
    if (issue) issue.state = "closed";
  }

  async reopenIssue(issueId: number): Promise<void> {
    this.calls.push({ method: "reopenIssue", args: { issueId } });
    const issue = this.issues.get(issueId);
    if (issue) issue.state = "opened";
  }

  async getMergedMRUrl(issueId: number): Promise<string | null> {
    this.calls.push({ method: "getMergedMRUrl", args: { issueId } });
    return this.mergedMrUrls.get(issueId) ?? null;
  }

  async getPrStatus(issueId: number): Promise<PrStatus> {
    this.calls.push({ method: "getPrStatus", args: { issueId } });
    return this.prStatuses.get(issueId) ?? { state: "closed", url: null };
  }

  async mergePr(issueId: number): Promise<void> {
    this.calls.push({ method: "mergePr", args: { issueId } });
    if (this.mergePrFailures.has(issueId)) {
      throw new Error(`Merge conflict: cannot merge PR for issue #${issueId}`);
    }
    // Simulate successful merge — update PR status to merged
    const existing = this.prStatuses.get(issueId);
    if (existing) {
      this.prStatuses.set(issueId, { ...existing, state: "merged" });
    }
  }

  async getPrDiff(issueId: number): Promise<string | null> {
    this.calls.push({ method: "getPrDiff", args: { issueId } });
    return this.prDiffs.get(issueId) ?? null;
  }

  async getPrReviewComments(_issueId: number): Promise<import("../providers/provider.js").PrReviewComment[]> {
    return [];
  }

  async reactToIssue(_issueId: number, _emoji: string): Promise<void> {
    // no-op in test provider
  }

  async issueHasReaction(_issueId: number, _emoji: string): Promise<boolean> {
    return true; // test provider assumes all issues are "new style"
  }

  async reactToPr(_issueId: number, _emoji: string): Promise<void> {
    // no-op in test provider
  }

  async prHasReaction(_issueId: number, _emoji: string): Promise<boolean> {
    return true; // test provider assumes all PRs are "new style"
  }

  async reactToIssueComment(_issueId: number, _commentId: number, _emoji: string): Promise<void> {
    // no-op in test provider
  }

  async reactToPrComment(_issueId: number, _commentId: number, _emoji: string): Promise<void> {
    // no-op in test provider
  }

  async reactToPrReview(_issueId: number, _reviewId: number, _emoji: string): Promise<void> {
    // no-op in test provider
  }

  async issueCommentHasReaction(_issueId: number, _commentId: number, _emoji: string): Promise<boolean> {
    return false; // test provider: no existing reactions
  }

  async prCommentHasReaction(_issueId: number, _commentId: number, _emoji: string): Promise<boolean> {
    return false; // test provider: no existing reactions
  }

  async prReviewHasReaction(_issueId: number, _reviewId: number, _emoji: string): Promise<boolean> {
    return false; // test provider: no existing reactions
  }

  async isCommitOnBaseBranch(_issueId: number, _baseBranch: string): Promise<boolean> {
    return false; // no-op in test provider
  }

  async addComment(issueId: number, body: string): Promise<number> {
    this.calls.push({ method: "addComment", args: { issueId, body } });
    const commentId = Date.now();
    const existing = this.comments.get(issueId) ?? [];
    existing.push({
      id: commentId,
      author: "test",
      body,
      created_at: new Date().toISOString(),
    });
    this.comments.set(issueId, existing);
    return commentId;
  }

  async editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue> {
    this.calls.push({ method: "editIssue", args: { issueId, updates } });
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`Issue #${issueId} not found in TestProvider`);
    if (updates.title !== undefined) issue.title = updates.title;
    if (updates.body !== undefined) issue.description = updates.body;
    return issue;
  }

  async uploadAttachment(
    _issueId: number,
    _file: { filename: string; buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    return null;
  }

  async healthCheck(): Promise<boolean> {
    this.calls.push({ method: "healthCheck", args: {} });
    return true;
  }
}
