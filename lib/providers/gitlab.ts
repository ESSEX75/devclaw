/**
 * GitLabProvider — IssueProvider implementation using glab CLI.
 */
import {
  type IssueProvider,
  type Issue,
  type StateLabel,
  type IssueComment,
  type PrStatus,
  type PrReviewComment,
  type SprintProviderCapabilities,
  type SprintReadinessCheck,
  PrState,
} from "./provider.js";
import type { RunCommand } from "../context.js";
import { withResilience } from "./resilience.js";
import {
  DEFAULT_WORKFLOW,
  getStateLabels,
  getLabelColors,
  type WorkflowConfig,
} from "../workflow/index.js";

type GitLabMR = {
  iid: number;
  title: string;
  description: string;
  web_url: string;
  state: string;
  source_branch?: string;
  target_branch?: string;
  merged_at: string | null;
  pipeline?: { status?: string } | null;
  approved_by?: Array<unknown>;
  author?: { username: string };
};

function getGitlabChecksPassed(mr: GitLabMR): boolean | undefined {
  const status = mr.pipeline?.status;
  if (!status) return undefined;
  if (status === "success" || status === "skipped") return true;
  if (["failed", "canceled", "cancelled"].includes(status)) return false;
  return undefined;
}

export class GitLabProvider implements IssueProvider {
  private repoPath: string;
  private workflow: WorkflowConfig;
  private runCommand: RunCommand;

  constructor(opts: { repoPath: string; runCommand: RunCommand; workflow?: WorkflowConfig }) {
    this.repoPath = opts.repoPath;
    this.runCommand = opts.runCommand;
    this.workflow = opts.workflow ?? DEFAULT_WORKFLOW;
  }

  private async glab(args: string[]): Promise<string> {
    return withResilience(async () => {
      const result = await this.runCommand(["glab", ...args], { timeoutMs: 30_000, cwd: this.repoPath });
      return result.stdout.trim();
    });
  }

  async getSprintCapabilities(): Promise<SprintProviderCapabilities> {
    return {
      issues: true,
      milestones: true,
      branches: true,
      pullRequests: true,
      autoMerge: true,
      nativeSubIssues: false,
      nativeDependencies: false,
    };
  }

  async checkSprintReadiness(opts: { baseBranch: string; reviewPolicy?: string }): Promise<{
    blocking: SprintReadinessCheck[];
    warnings: SprintReadinessCheck[];
  }> {
    const blocking: SprintReadinessCheck[] = [];
    const warnings: SprintReadinessCheck[] = [];

    try {
      await this.glab(["auth", "status"]);
    } catch (err) {
      return {
        blocking: [{
          code: "provider_auth",
          message: `GitLab CLI authentication failed: ${(err as Error).message}`,
        }],
        warnings,
      };
    }

    let project: {
      id?: number;
      issues_enabled?: boolean;
      merge_requests_enabled?: boolean;
      permissions?: {
        project_access?: { access_level?: number } | null;
        group_access?: { access_level?: number } | null;
      };
    } | null = null;
    try {
      const raw = await this.glab(["api", "projects/:id", "--method", "GET"]);
      project = JSON.parse(raw);
    } catch (err) {
      return {
        blocking: [{
          code: "repository_not_found",
          message: `GitLab project could not be resolved: ${(err as Error).message}`,
        }],
        warnings,
      };
    }

    try {
      await this.glab(["api", `projects/:id/repository/branches/${encodeURIComponent(opts.baseBranch)}`, "--method", "GET"]);
    } catch {
      blocking.push({
        code: "base_branch_missing",
        message: `Base branch "${opts.baseBranch}" does not exist on GitLab.`,
        details: { baseBranch: opts.baseBranch },
      });
    }

    const projectAccess = project?.permissions?.project_access?.access_level ?? 0;
    const groupAccess = project?.permissions?.group_access?.access_level ?? 0;
    const accessLevel = Math.max(projectAccess, groupAccess);
    const canWrite = accessLevel >= 30;

    if (!project?.issues_enabled) {
      blocking.push({
        code: "missing_sprint_capability",
        message: "GitLab issues are disabled for this project.",
        details: { capability: "issues" },
      });
    }
    if (!project?.merge_requests_enabled) {
      blocking.push({
        code: "missing_sprint_capability",
        message: "GitLab merge requests are disabled for this project.",
        details: { capability: "pullRequests" },
      });
    }
    if (!canWrite) {
      blocking.push({
        code: "provider_permissions",
        message: `GitLab access level ${accessLevel} is insufficient for sprint issue, milestone, branch, and MR operations.`,
        details: { accessLevel },
      });
    }
    if ((opts.reviewPolicy === "sprint" || opts.reviewPolicy === "skip") && !canWrite) {
      blocking.push({
        code: "auto_merge_blocked",
        message: `GitLab access level ${accessLevel} cannot satisfy automatic sprint merge behavior.`,
        details: { reviewPolicy: opts.reviewPolicy, accessLevel },
      });
    }

    const capabilities = await this.getSprintCapabilities();
    if (!capabilities.nativeSubIssues) {
      warnings.push({
        code: "native_sub_issues_unavailable",
        message: "GitLab native sub-issues are unavailable; DevClaw will use issue body metadata fallback.",
      });
    }
    if (!capabilities.nativeDependencies) {
      warnings.push({
        code: "native_dependencies_unavailable",
        message: "GitLab native dependency relationships are unavailable; DevClaw will keep the graph in local state.",
      });
    }

    return { blocking, warnings };
  }

  async createSprintMilestone(input: { title: string; description?: string }): Promise<import("./provider.js").SprintMilestone> {
    const raw = await this.glab([
      "api", "projects/:id/milestones",
      "--method", "POST",
      "--field", `title=${input.title}`,
      "--field", `description=${input.description ?? ""}`,
    ]);
    const milestone = JSON.parse(raw) as { id: number; iid?: number; title: string; web_url?: string };
    return { id: String(milestone.iid ?? milestone.id), title: milestone.title, url: milestone.web_url };
  }

  private async createSprintIssue(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    const args = [
      "issue", "create",
      "--title", input.title,
      "--description", input.body,
    ];
    if (input.labels?.length) args.push("--label", input.labels.join(","));
    if (input.milestoneId) args.push("--milestone", input.milestoneId);
    if (input.assignees?.length) args.push("--assignee", input.assignees.join(","));
    const stdout = await this.glab(args);
    const match = stdout.match(/\/issues\/(\d+)/);
    if (!match) throw new Error(`Failed to parse issue URL: ${stdout}`);
    return this.getIssue(parseInt(match[1], 10));
  }

  async createSprintRoot(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    return this.createSprintIssue({
      ...input,
      labels: [...new Set(["sprint:root", ...(input.labels ?? [])])],
    });
  }

  async createChildIssue(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    return this.createSprintIssue({
      ...input,
      labels: [...new Set(["sprint:child", ...(input.labels ?? [])])],
    });
  }

  async linkChildIssue(input: { rootIssueId: number; childIssueId: number }): Promise<void> {
    await this.addComment(
      input.rootIssueId,
      `DevClaw sprint projection: child issue #${input.childIssueId}`,
    );
    await this.addComment(
      input.childIssueId,
      `DevClaw sprint projection: parent sprint issue #${input.rootIssueId}`,
    );
  }

  async linkIssueDependency(input: { blockedIssueId: number; blockingIssueId: number }): Promise<void> {
    await this.addComment(
      input.blockingIssueId,
      `DevClaw sprint projection: #${input.blockingIssueId} blocks #${input.blockedIssueId}`,
    );
    await this.addComment(
      input.blockedIssueId,
      `DevClaw sprint projection: blocked by #${input.blockingIssueId}`,
    );
  }

  async assignIssue(input: { issueId: number; assignees: string[] }): Promise<void> {
    if (input.assignees.length === 0) return;
    await this.glab(["issue", "update", String(input.issueId), "--assignee", input.assignees.join(",")]);
  }

  private async createBranch(input: { branch: string; fromBranch: string }): Promise<import("./provider.js").SprintBranch> {
    try {
      await this.glab([
        "api", "projects/:id/repository/branches",
        "--method", "POST",
        "--field", `branch=${input.branch}`,
        "--field", `ref=${input.fromBranch}`,
      ]);
    } catch (err) {
      if (!String((err as Error).message).includes("already exists")) throw err;
    }
    return { name: input.branch, base: input.fromBranch };
  }

  async createSprintBranch(input: { branch: string; fromBranch: string }): Promise<import("./provider.js").SprintBranch> {
    return this.createBranch(input);
  }

  async createWorkBranch(input: { branch: string; fromBranch: string }): Promise<import("./provider.js").SprintBranch> {
    return this.createBranch(input);
  }

  async createPullRequest(input: {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
    issueId?: number;
  }): Promise<import("./provider.js").SprintPullRequest> {
    const description = input.issueId ? `${input.body}\n\nCloses #${input.issueId}` : input.body;
    const stdout = await this.glab([
      "mr", "create",
      "--title", input.title,
      "--description", description,
      "--source-branch", input.sourceBranch,
      "--target-branch", input.targetBranch,
    ]);
    const match = stdout.match(/\/merge_requests\/(\d+)/);
    return {
      id: match?.[1] ?? stdout,
      url: stdout.trim(),
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
    };
  }

  async linkPullRequestToIssue(input: { issueId: number; pullRequestId: string; pullRequestUrl: string }): Promise<void> {
    await this.addComment(
      input.issueId,
      `DevClaw sprint projection: merge request ${input.pullRequestUrl} (${input.pullRequestId})`,
    );
  }

  async readSprintTree(input: { rootIssueId: number }): Promise<import("./provider.js").SprintTree> {
    const rootIssue = await this.getIssue(input.rootIssueId);
    const comments = await this.listComments(input.rootIssueId);
    const childIds = [...new Set(comments.flatMap((comment) =>
      [...comment.body.matchAll(/child issue #(\d+)/gi)].map((match) => Number(match[1])),
    ))];
    const childIssues = await Promise.all(childIds.map((id) => this.getIssue(id)));
    return {
      rootIssue,
      childIssues,
      dependencies: await this.readDependencies({ issueIds: [input.rootIssueId, ...childIds] }),
      pullRequests: [],
    };
  }

  async readDependencies(input: { issueIds: number[] }): Promise<import("./provider.js").SprintDependency[]> {
    const dependencies: import("./provider.js").SprintDependency[] = [];
    for (const issueId of input.issueIds) {
      const comments = await this.listComments(issueId);
      for (const comment of comments) {
        for (const match of comment.body.matchAll(/#(\d+)\s+blocks\s+#(\d+)/gi)) {
          dependencies.push({
            blockingIssueId: Number(match[1]),
            blockedIssueId: Number(match[2]),
            native: false,
          });
        }
      }
    }
    return dependencies;
  }

  async closeSprintMilestone(input: { milestoneId: string }): Promise<void> {
    await this.glab([
      "api", `projects/:id/milestones/${input.milestoneId}`,
      "--method", "PUT",
      "--field", "state_event=close",
    ]);
  }

  async guardManagedProjection(input: {
    rootIssueId: number;
    expectedMetadata: Record<string, unknown>;
    repair?: boolean;
  }): Promise<import("./provider.js").ManagedProjectionGuardResult> {
    const issue = await this.getIssue(input.rootIssueId);
    const expected = JSON.stringify(input.expectedMetadata);
    if (issue.description.includes(expected)) {
      return { ok: true, repaired: [], integrityErrors: [] };
    }
    const error = "Sprint root issue managed metadata differs from DevClaw state.";
    if (!input.repair) return { ok: false, repaired: [], integrityErrors: [error] };
    await this.editIssue(input.rootIssueId, {
      body: `${issue.description}\n\n<!-- devclaw:sprint-metadata ${expected} -->`,
    });
    return { ok: true, repaired: ["rootIssue.metadata"], integrityErrors: [] };
  }

  /** Get MRs linked to an issue via GitLab's native related_merge_requests API. */
  private async getRelatedMRs(issueId: number): Promise<GitLabMR[]> {
    try {
      const raw = await this.glab(["api", `projects/:id/issues/${issueId}/related_merge_requests`, "--paginate"]);
      if (!raw) return [];
      return JSON.parse(raw) as GitLabMR[];
    } catch { return []; }
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    try {
      // Update-first: always set the color on existing labels
      await this.glab([
        "api", `projects/:id/labels/${encodeURIComponent(name)}`,
        "--method", "PUT",
        "--field", `color=${color}`,
      ]);
    } catch {
      // Label doesn't exist yet — create it
      await this.glab([
        "api", "projects/:id/labels",
        "--method", "POST",
        "--field", `name=${name}`,
        "--field", `color=${color}`,
      ]);
    }
  }

  async ensureAllStateLabels(): Promise<void> {
    const labels = getStateLabels(this.workflow);
    const colors = getLabelColors(this.workflow);
    for (const label of labels) {
      await this.ensureLabel(label, colors[label]);
    }
  }

  async createIssue(title: string, description: string, label: StateLabel, assignees?: string[]): Promise<Issue> {
    // Pass description directly as argv — runCommand uses spawn (no shell),
    // so no escaping issues with special characters.
    const args = ["issue", "create", "--title", title, "--description", description, "--label", label];
    if (assignees?.length) args.push("--assignee", assignees.join(","));
    const stdout = await this.glab(args);
    // glab issue create returns the issue URL
    const match = stdout.match(/\/issues\/(\d+)/);
    if (!match) throw new Error(`Failed to parse issue URL: ${stdout}`);
    return this.getIssue(parseInt(match[1], 10));
  }

  async listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    try {
      const raw = await this.glab(["issue", "list", "--label", label, "--output", "json"]);
      return JSON.parse(raw) as Issue[];
    } catch { return []; }
  }

  async listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]> {
    try {
      const args = ["issue", "list", "--output", "json"];
      if (opts?.label) args.push("--label", opts.label);
      if (opts?.state === "closed") args.push("--closed");
      else if (opts?.state === "all") args.push("--all");
      else args.push("--opened");
      const raw = await this.glab(args);
      return JSON.parse(raw) as Issue[];
    } catch { return []; }
  }

  async getIssue(issueId: number): Promise<Issue> {
    const raw = await this.glab(["issue", "view", String(issueId), "--output", "json"]);
    return JSON.parse(raw) as Issue;
  }

  async listComments(issueId: number): Promise<IssueComment[]> {
    try {
      const raw = await this.glab(["api", `projects/:id/issues/${issueId}/notes`, "--paginate"]);
      const notes = JSON.parse(raw) as Array<{ id: number; author: { username: string }; body: string; created_at: string; system: boolean }>;
      // Filter out system notes (e.g. "changed label", "closed issue")
      return notes
        .filter((note) => !note.system)
        .map((note) => ({
          id: note.id,
          author: note.author.username,
          body: note.body,
          created_at: note.created_at,
        }));
    } catch { return []; }
  }

  async transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void> {
    // Two-phase transition to prevent label loss on failure:
    // Phase 1: Add new label first — issue is correctly labelled even if phase 2 fails
    // Phase 2: Remove old state labels (best-effort)
    await this.glab(["issue", "update", String(issueId), "--label", to]);

    const issue = await this.getIssue(issueId);
    const stateLabels = getStateLabels(this.workflow);
    const currentStateLabels = issue.labels.filter((l) => stateLabels.includes(l) && l !== to);

    if (currentStateLabels.length > 0) {
      const args = ["issue", "update", String(issueId)];
      for (const l of currentStateLabels) args.push("--unlabel", l);
      await this.glab(args);
    }

    // Post-transition validation: verify exactly one state label remains (#473)
    try {
      const postIssue = await this.getIssue(issueId);
      const postStateLabels = postIssue.labels.filter((l) => stateLabels.includes(l));
      if (postStateLabels.length !== 1 || !postStateLabels.includes(to)) {
        console.error(
          `[state_transition_anomaly] Issue #${issueId}: expected state "${to}", ` +
          `found ${postStateLabels.length} state label(s): [${postStateLabels.join(", ")}]. ` +
          `Transition: "${from}" → "${to}". See #473.`,
        );
      }
    } catch {
      // Validation is best-effort
    }
  }

  async addLabel(issueId: number, label: string): Promise<void> {
    await this.glab(["issue", "update", String(issueId), "--label", label]);
  }

  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "update", String(issueId)];
    for (const l of labels) args.push("--unlabel", l);
    await this.glab(args);
  }

  async closeIssue(issueId: number): Promise<void> { await this.glab(["issue", "close", String(issueId)]); }
  async reopenIssue(issueId: number): Promise<void> { await this.glab(["issue", "reopen", String(issueId)]); }

  async getMergedMRUrl(issueId: number): Promise<string | null> {
    const mrs = await this.getRelatedMRs(issueId);
    const merged = mrs
      .filter((mr) => mr.state === "merged" && mr.merged_at)
      .sort((a, b) => new Date(b.merged_at!).getTime() - new Date(a.merged_at!).getTime());
    return merged[0]?.web_url ?? null;
  }

  async getPrStatus(issueId: number): Promise<PrStatus> {
    const mrs = await this.getRelatedMRs(issueId);
    // Check open MRs first
    const open = mrs.find((mr) => mr.state === "opened");
    if (open) {
      const approved = await this.isMrApproved(open.iid);

      // Detect changes requested via unresolved discussion threads
      let state: PrState;
      if (approved) {
        state = PrState.APPROVED;
      } else {
        const hasUnresolved = await this.hasUnresolvedDiscussions(open.iid);
        if (hasUnresolved) {
          state = PrState.CHANGES_REQUESTED;
        } else {
          // Check for top-level conversation comments from non-author users
          const hasComments = await this.hasConversationComments(open.iid);
          state = hasComments ? PrState.HAS_COMMENTS : PrState.OPEN;
        }
      }

      // Detect merge conflicts
      const mergeable = await this.isMrMergeable(open.iid);

      return {
        state,
        url: open.web_url,
        title: open.title,
        sourceBranch: open.source_branch,
        targetBranch: open.target_branch,
        baseBranch: open.target_branch,
        mergeable,
        checksPassed: getGitlabChecksPassed(open),
      };
    }
    // Check merged MRs
    const merged = mrs.find((mr) => mr.state === "merged");
    if (merged) return { state: PrState.MERGED, url: merged.web_url, title: merged.title, sourceBranch: merged.source_branch, targetBranch: merged.target_branch, baseBranch: merged.target_branch, checksPassed: true };
    // Check for closed-without-merge MRs. url: non-null = MR was explicitly closed;
    // url: null = no MR has ever been created for this issue.
    const closed = mrs.find((mr) => mr.state === "closed");
    if (closed) return { state: PrState.CLOSED, url: closed.web_url, title: closed.title, sourceBranch: closed.source_branch, targetBranch: closed.target_branch, baseBranch: closed.target_branch };
    return { state: PrState.CLOSED, url: null };
  }

  /** Check if an MR has unresolved discussion threads (proxy for changes requested). */
  private async hasUnresolvedDiscussions(mrIid: number): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/discussions`]);
      const discussions = JSON.parse(raw) as Array<{ notes: Array<{ resolvable: boolean; resolved: boolean; system: boolean }> }>;
      return discussions.some((d) =>
        d.notes.some((n) => n.resolvable && !n.resolved && !n.system),
      );
    } catch { return false; }
  }

  /**
   * Check if an MR has any top-level conversation notes from human users.
   * Excludes only system notes and empty bodies (author comments are included).
   * Uses the MR notes endpoint (regular comments, not threaded discussions).
   */
  private async hasConversationComments(mrIid: number): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/notes`]);
      const notes = JSON.parse(raw) as Array<{ id: number; system: boolean; body: string }>;
      const candidates = notes.filter((n) => !n.system && n.body.trim().length > 0);
      for (const note of candidates) {
        if (!(await this.noteHasEyesEmoji(mrIid, note.id))) return true;
      }
      return false;
    } catch { return false; }
  }

  /** Check if a note already has an 👀 award emoji (marks it as processed). */
  private async noteHasEyesEmoji(mrIid: number, noteId: number): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/notes/${noteId}/award_emoji`]);
      const emojis = JSON.parse(raw) as Array<{ name: string }>;
      return emojis.some((e) => e.name === "eyes");
    } catch { return false; }
  }

  /**
   * Fetch top-level conversation notes on an MR from human users.
   * Excludes only system notes and empty bodies.
   */
  private async fetchConversationComments(
    mrIid: number,
  ): Promise<Array<{ id: number; author: { username: string }; body: string; created_at: string }>> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/notes`]);
      const all = JSON.parse(raw) as Array<{ id: number; author: { username: string }; system: boolean; body: string; created_at: string }>;
      return all.filter(
        (n) => !n.system && n.body.trim().length > 0,
      );
    } catch { return []; }
  }

  /** Check MR merge status for conflicts. */
  private async isMrMergeable(mrIid: number): Promise<boolean | undefined> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}?include_rebase_in_progress=true`]);
      const mr = JSON.parse(raw) as { has_conflicts?: boolean; detailed_merge_status?: string };
      if (mr.has_conflicts === true) return false;
      if (mr.detailed_merge_status === "conflict") return false;
      if (mr.detailed_merge_status === "mergeable" || mr.detailed_merge_status === "ci_must_pass") return true;
      return undefined; // Unknown
    } catch { return undefined; }
  }

  /** Check if an MR is approved via the dedicated approvals endpoint. */
  private async isMrApproved(mrIid: number): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/approvals`]);
      const data = JSON.parse(raw) as {
        approved?: boolean;
        approvals_left?: number;
        approved_by?: Array<unknown>;
      };
      // Only trust explicit approvals — ignore bare 'approved' flag.
      // When a project has zero approval rules, GitLab returns approved:true
      // even though nobody has actually reviewed, causing false positives.
      const hasExplicitApproval = Array.isArray(data.approved_by) && data.approved_by.length > 0;
      if (!hasExplicitApproval) return false;
      // All required approvals satisfied
      return (data.approvals_left ?? 1) <= 0;
    } catch { return false; }
  }

  async mergePr(issueId: number): Promise<void> {
    const mrs = await this.getRelatedMRs(issueId);
    const open = mrs.find((mr) => mr.state === "opened");
    if (!open) throw new Error(`No open MR found for issue #${issueId}`);
    await this.glab(["mr", "merge", String(open.iid)]);
  }

  async getPrDiff(issueId: number): Promise<string | null> {
    const mrs = await this.getRelatedMRs(issueId);
    const open = mrs.find((mr) => mr.state === "opened");
    if (!open) return null;
    try {
      return await this.glab(["mr", "diff", String(open.iid)]);
    } catch { return null; }
  }

  async getPrReviewComments(issueId: number): Promise<PrReviewComment[]> {
    const mrs = await this.getRelatedMRs(issueId);
    const open = mrs.find((mr) => mr.state === "opened");
    if (!open) return [];
    const comments: PrReviewComment[] = [];

    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${open.iid}/discussions`]);
      const discussions = JSON.parse(raw) as Array<{
        notes: Array<{
          id: number; author: { username: string }; body: string;
          resolvable: boolean; resolved: boolean; system: boolean;
          created_at: string; position?: { new_path?: string; new_line?: number };
        }>;
      }>;

      for (const disc of discussions) {
        for (const note of disc.notes) {
          if (note.system) continue;
          comments.push({
            id: note.id,
            author: note.author.username,
            body: note.body,
            state: note.resolvable ? (note.resolved ? "RESOLVED" : "UNRESOLVED") : "COMMENTED",
            created_at: note.created_at,
            path: note.position?.new_path,
            line: note.position?.new_line ?? undefined,
          });
        }
      }
    } catch { /* best-effort */ }

    // Also include top-level conversation notes (regular MR comments, not threaded)
    const conversationNotes = await this.fetchConversationComments(open.iid);
    for (const n of conversationNotes) {
      // Avoid duplicates: discussions endpoint may already include these
      if (!comments.some((c) => c.id === n.id)) {
        comments.push({
          id: n.id,
          author: n.author.username,
          body: n.body,
          state: "COMMENTED",
          created_at: n.created_at,
        });
      }
    }

    comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return comments;
  }

  async addComment(issueId: number, body: string): Promise<number> {
    const raw = await this.glab([
      "api", `projects/:id/issues/${issueId}/notes`,
      "--method", "POST",
      "--field", `body=${body}`,
    ]);
    const parsed = JSON.parse(raw) as { id: number };
    return parsed.id;
  }

  /**
   * Add an emoji award (reaction) to an MR note/comment.
   * Uses the GitLab Award Emoji API on MR notes.
   * Best-effort — swallows all errors.
   * @param issueId  Used to locate the associated open MR via getRelatedMRs
   * @param commentId  The note ID on the MR
   * @param emoji  Emoji name without colons (e.g. "robot", "thumbsup")
   */
  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.glab([
        "api", `projects/:id/issues/${issueId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/issues/${issueId}/award_emoji`]);
      const emojis = JSON.parse(raw) as Array<{ name: string }>;
      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");
      if (!open) return;
      await this.glab([
        "api", `projects/:id/merge_requests/${open.iid}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");
      if (!open) return false;
      const raw = await this.glab(["api", `projects/:id/merge_requests/${open.iid}/award_emoji`]);
      const emojis = JSON.parse(raw) as Array<{ name: string }>;
      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.glab([
        "api", `projects/:id/issues/${issueId}/notes/${commentId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");
      if (!open) return;
      await this.glab([
        "api", `projects/:id/merge_requests/${open.iid}/notes/${commentId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async reactToPrReview(issueId: number, reviewId: number, emoji: string): Promise<void> {
    // GitLab doesn't distinguish reviews from comments — use the same note reaction API
    await this.reactToPrComment(issueId, reviewId, emoji);
  }

  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/issues/${issueId}/notes/${commentId}/award_emoji`]);
      const emojis = JSON.parse(raw) as Array<{ name: string }>;
      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");
      if (!open) return false;
      const raw = await this.glab([
        "api", `projects/:id/merge_requests/${open.iid}/notes/${commentId}/award_emoji`,
      ]);
      const emojis = JSON.parse(raw) as Array<{ name: string }>;
      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async prReviewHasReaction(issueId: number, reviewId: number, emoji: string): Promise<boolean> {
    // GitLab doesn't distinguish reviews from comments, so use the same logic as prCommentHasReaction
    return this.prCommentHasReaction(issueId, reviewId, emoji);
  }

  async editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue> {
    const args = ["issue", "update", String(issueId)];
    if (updates.title !== undefined) args.push("--title", updates.title);
    if (updates.body !== undefined) args.push("--description", updates.body);
    await this.glab(args);
    return this.getIssue(issueId);
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches the last 200 commits on baseBranch for commit messages mentioning #issueId or !issueId.
   * Used as a fallback when no MR exists (e.g., direct commit to main).
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      // Search for issue references: #N (issue) or !N (MR) in commit messages
      const patterns = [`#${issueId}`, `!${issueId}`];
      for (const pattern of patterns) {
        const result = await this.runCommand(
          ["git", "log", `origin/${baseBranch}`, "--oneline", "-200", "--grep", pattern],
          { timeoutMs: 15_000, cwd: this.repoPath },
        );
        if (result.stdout.trim().length > 0) return true;
      }
      return false;
    } catch { return false; }
  }

  async uploadAttachment(
    issueId: number,
    file: { filename: string; buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    try {
      // Get project info and auth token
      const projectRaw = await this.glab(["api", "projects/:id", "--method", "GET"]);
      const project = JSON.parse(projectRaw);
      const projectId: number = project.id;
      const webUrl: string = project.web_url;

      const tokenRaw = await this.runCommand(
        ["glab", "config", "get", "token"],
        { timeoutMs: 10_000, cwd: this.repoPath },
      );
      const token = tokenRaw.stdout.trim();
      if (!token) return null;

      // Write to temp file for curl multipart upload
      const os = await import("node:os");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-upload-"));
      const tmpFile = path.join(tmpDir, file.filename);
      await fs.writeFile(tmpFile, file.buffer);

      try {
        const apiBase = webUrl.replace(/\/[^/]+\/[^/]+\/?$/, "");
        const result = await this.runCommand(
          ["curl", "--silent", "--fail", "--show-error",
            "--header", `PRIVATE-TOKEN: ${token}`,
            "--form", `file=@${tmpFile}`,
            `${apiBase}/api/v4/projects/${projectId}/uploads`],
          { timeoutMs: 30_000, cwd: this.repoPath },
        );
        const parsed = JSON.parse(result.stdout);
        if (parsed.full_path) return `${webUrl}${parsed.full_path}`;
        if (parsed.url) return `${webUrl}${parsed.url}`;
        return null;
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
        await fs.rmdir(tmpDir).catch(() => {});
      }
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try { await this.glab(["auth", "status"]); return true; } catch { return false; }
  }
}
