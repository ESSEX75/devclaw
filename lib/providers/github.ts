/**
 * GitHubProvider — IssueProvider implementation using gh CLI.
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

type GhIssue = {
  id?: number;
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  state: string;
  url: string;
};

type GhPrStatusCheck = {
  conclusion?: string | null;
  status?: string | null;
};

function toIssue(gh: GhIssue): Issue {
  return {
    iid: gh.number,
    ...(gh.id !== undefined ? { providerId: gh.id } : {}),
    title: gh.title,
    description: gh.body ?? "",
    labels: gh.labels.map((l) => l.name), state: gh.state, web_url: gh.url,
  };
}

function checksPassedFromGithubRollup(rollup: unknown): boolean | undefined {
  if (!Array.isArray(rollup)) return undefined;
  if (rollup.length === 0) return true;
  return rollup.every((check) => {
    const record = check as GhPrStatusCheck;
    if (record.conclusion) {
      return ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(record.conclusion);
    }
    return record.status === "COMPLETED";
  });
}

export class GitHubProvider implements IssueProvider {
  private repoPath: string;
  private workflow: WorkflowConfig;
  private runCommand: RunCommand;

  constructor(opts: { repoPath: string; runCommand: RunCommand; workflow?: WorkflowConfig }) {
    this.repoPath = opts.repoPath;
    this.runCommand = opts.runCommand;
    this.workflow = opts.workflow ?? DEFAULT_WORKFLOW;
  }

  private async gh(args: string[]): Promise<string> {
    return withResilience(async () => {
      const result = await this.runCommand(["gh", ...args], { timeoutMs: 30_000, cwd: this.repoPath });
      if (result.code != null && result.code !== 0) {
        throw new Error(result.stderr?.trim() || `gh command failed with exit code ${result.code}`);
      }
      return result.stdout.trim();
    });
  }

  /** Cached repo owner/name for GraphQL queries. */
  private repoInfo: { owner: string; name: string } | null | undefined = undefined;

  /**
   * Get repo owner and name via gh CLI. Cached per instance.
   * Returns null if unavailable (no git remote, etc.).
   */
  private async getRepoInfo(): Promise<{ owner: string; name: string } | null> {
    if (this.repoInfo !== undefined) return this.repoInfo;
    try {
      const raw = await this.gh(["repo", "view", "--json", "owner,name"]);
      const data = JSON.parse(raw);
      this.repoInfo = { owner: data.owner.login, name: data.name };
    } catch {
      this.repoInfo = null;
    }
    return this.repoInfo;
  }

  async getSprintCapabilities(): Promise<SprintProviderCapabilities> {
    return {
      issues: true,
      milestones: true,
      branches: true,
      pullRequests: true,
      autoMerge: true,
      nativeSubIssues: true,
      nativeDependencies: true,
    };
  }

  async checkSprintReadiness(opts: { baseBranch: string; reviewPolicy?: string }): Promise<{
    blocking: SprintReadinessCheck[];
    warnings: SprintReadinessCheck[];
  }> {
    const blocking: SprintReadinessCheck[] = [];
    const warnings: SprintReadinessCheck[] = [];

    try {
      await this.gh(["auth", "status"]);
    } catch (err) {
      return {
        blocking: [{
          code: "provider_auth",
          message: `GitHub CLI authentication failed: ${(err as Error).message}`,
        }],
        warnings,
      };
    }

    const repo = await this.getRepoInfo();
    if (!repo) {
      return {
        blocking: [{
          code: "repository_not_found",
          message: "GitHub repository could not be resolved from the current repo.",
        }],
        warnings,
      };
    }

    try {
      await this.gh(["api", `repos/${repo.owner}/${repo.name}/branches/${encodeURIComponent(opts.baseBranch)}`]);
    } catch {
      blocking.push({
        code: "base_branch_missing",
        message: `Base branch "${opts.baseBranch}" does not exist on GitHub.`,
        details: { baseBranch: opts.baseBranch },
      });
    }

    try {
      const raw = await this.gh(["repo", "view", "--json", "viewerPermission,hasIssuesEnabled"]);
      const repoView = JSON.parse(raw) as { viewerPermission?: string; hasIssuesEnabled?: boolean };
      const permission = repoView.viewerPermission ?? "UNKNOWN";
      const canWrite = ["ADMIN", "MAINTAIN", "WRITE"].includes(permission);
      if (!repoView.hasIssuesEnabled) {
        blocking.push({
          code: "missing_sprint_capability",
          message: "GitHub issues are disabled for this repository.",
          details: { capability: "issues" },
        });
      }
      if (!canWrite) {
        blocking.push({
          code: "provider_permissions",
          message: `GitHub permission "${permission}" is insufficient for sprint issue, milestone, branch, and PR operations.`,
          details: { permission },
        });
      }
      if ((opts.reviewPolicy === "sprint" || opts.reviewPolicy === "skip") && !canWrite) {
        blocking.push({
          code: "auto_merge_blocked",
          message: `GitHub permission "${permission}" cannot satisfy automatic sprint merge behavior.`,
          details: { reviewPolicy: opts.reviewPolicy, permission },
        });
      }
    } catch (err) {
      blocking.push({
        code: "provider_permissions",
        message: `GitHub repository permission check failed: ${(err as Error).message}`,
      });
    }

    const capabilities = await this.getSprintCapabilities();
    if (!capabilities.nativeSubIssues) {
      warnings.push({
        code: "native_sub_issues_unavailable",
        message: "GitHub native sub-issues are unavailable; DevClaw will use issue body metadata fallback.",
      });
    }
    if (!capabilities.nativeDependencies) {
      warnings.push({
        code: "native_dependencies_unavailable",
        message: "GitHub native dependency relationships are unavailable; DevClaw will keep the graph in local state.",
      });
    }

    return { blocking, warnings };
  }

  async createSprintMilestone(input: { title: string; description?: string }): Promise<import("./provider.js").SprintMilestone> {
    const raw = await this.gh([
      "api", "repos/:owner/:repo/milestones",
      "--method", "POST",
      "--field", `title=${input.title}`,
      "--field", `description=${input.description ?? ""}`,
    ]);
    const milestone = JSON.parse(raw) as { number: number; title: string; html_url?: string };
    return { id: String(milestone.number), title: milestone.title, url: milestone.html_url };
  }

  private async createSprintIssue(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue> {
    const args = [
      "api", "repos/:owner/:repo/issues",
      "--method", "POST",
      "--field", `title=${input.title}`,
      "--field", `body=${input.body}`,
    ];
    if (input.milestoneId) args.push("--field", `milestone=${input.milestoneId}`);
    for (const label of input.labels ?? []) args.push("--field", `labels[]=${label}`);
    for (const assignee of input.assignees ?? []) args.push("--field", `assignees[]=${assignee}`);
    const raw = await this.gh(args);
    const issue = JSON.parse(raw) as { number: number };
    return this.getIssue(issue.number);
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
    const capabilities = await this.getSprintCapabilities();
    if (capabilities.nativeSubIssues) {
      await this.tryCreateNativeSubIssue(input);
    }
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
    const capabilities = await this.getSprintCapabilities();
    if (capabilities.nativeDependencies) {
      await this.tryCreateNativeBlockedByDependency(input);
    }
    await this.addComment(
      input.blockingIssueId,
      `DevClaw sprint projection: #${input.blockingIssueId} blocks #${input.blockedIssueId}`,
    );
    await this.addComment(
      input.blockedIssueId,
      `DevClaw sprint projection: blocked by #${input.blockingIssueId}`,
    );
  }

  private async getIssueProviderId(issueId: number): Promise<number> {
    const raw = await this.gh(["api", `repos/:owner/:repo/issues/${issueId}`, "--jq", ".id"]);
    const providerId = Number(raw);
    if (!Number.isInteger(providerId)) throw new Error(`GitHub issue #${issueId} did not return a numeric database id.`);
    return providerId;
  }

  private async tryCreateNativeSubIssue(input: { rootIssueId: number; childIssueId: number }): Promise<void> {
    try {
      const childProviderId = await this.getIssueProviderId(input.childIssueId);
      await this.gh([
        "api", `repos/:owner/:repo/issues/${input.rootIssueId}/sub_issues`,
        "--method", "POST",
        "--field", `sub_issue_id=${childProviderId}`,
      ]);
    } catch (err) {
      console.warn(`[sprint_projection_warning] Failed to create native GitHub sub-issue link #${input.rootIssueId} -> #${input.childIssueId}: ${(err as Error).message}`);
    }
  }

  private async tryCreateNativeBlockedByDependency(input: { blockedIssueId: number; blockingIssueId: number }): Promise<void> {
    try {
      const blockingProviderId = await this.getIssueProviderId(input.blockingIssueId);
      await this.gh([
        "api", `repos/:owner/:repo/issues/${input.blockedIssueId}/dependencies/blocked_by`,
        "--method", "POST",
        "--field", `issue_id=${blockingProviderId}`,
      ]);
    } catch (err) {
      console.warn(`[sprint_projection_warning] Failed to create native GitHub dependency #${input.blockedIssueId} blocked by #${input.blockingIssueId}: ${(err as Error).message}`);
    }
  }

  async assignIssue(input: { issueId: number; assignees: string[] }): Promise<void> {
    if (input.assignees.length === 0) return;
    await this.gh(["issue", "edit", String(input.issueId), "--add-assignee", input.assignees.join(",")]);
  }

  private async createBranch(input: { branch: string; fromBranch: string }): Promise<import("./provider.js").SprintBranch> {
    const repo = await this.getRepoInfo();
    if (!repo) throw new Error("GitHub repository could not be resolved.");
    let sha = "";
    try {
      sha = await this.gh([
        "api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${input.fromBranch}`,
        "--jq", ".object.sha",
      ]);
    } catch {
      throw new Error(`Base branch "${input.fromBranch}" does not exist.`);
    }
    try {
      await this.gh([
        "api", `repos/${repo.owner}/${repo.name}/git/refs`,
        "--method", "POST",
        "--field", `ref=refs/heads/${input.branch}`,
        "--field", `sha=${sha.trim()}`,
      ]);
    } catch (err) {
      if (!String((err as Error).message).includes("Reference already exists")) throw err;
    }
    return {
      name: input.branch,
      base: input.fromBranch,
      url: `https://github.com/${repo.owner}/${repo.name}/tree/${encodeURIComponent(input.branch)}`,
    };
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
    const body = input.issueId && !referencesIssue(input.body, input.issueId)
      ? `${input.body}\n\nRefs #${input.issueId}`
      : input.body;
    const url = await this.gh([
      "pr", "create",
      "--title", input.title,
      "--body", body,
      "--head", input.sourceBranch,
      "--base", input.targetBranch,
    ]);
    const match = url.match(/\/pull\/(\d+)/);
    return {
      id: match?.[1] ?? url,
      url,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
    };
  }

  async linkPullRequestToIssue(input: { issueId: number; pullRequestId: string; pullRequestUrl: string }): Promise<void> {
    await this.addComment(
      input.issueId,
      `DevClaw sprint projection: pull request ${input.pullRequestUrl} (${input.pullRequestId})`,
    );
  }

  async readSprintTree(input: { rootIssueId: number }): Promise<import("./provider.js").SprintTree> {
    const rootIssue = await this.getIssue(input.rootIssueId);
    const comments = await this.listComments(input.rootIssueId);
    const childIds = [...new Set(comments.flatMap((comment) =>
      [...comment.body.matchAll(/child issue #(\d+)/gi)].map((match) => Number(match[1])),
    ))];
    const childIssues = await Promise.all(childIds.map((id) => this.getIssue(id)));
    const issueIds = [input.rootIssueId, ...childIds];
    const pullRequests = await this.readSprintPullRequests(issueIds);
    return {
      rootIssue,
      childIssues,
      dependencies: await this.readDependencies({ issueIds: [input.rootIssueId, ...childIds] }),
      pullRequests,
    };
  }

  private async readSprintPullRequests(issueIds: number[]): Promise<import("./provider.js").SprintPullRequest[]> {
    const byUrl = new Map<string, import("./provider.js").SprintPullRequest>();
    for (const issueId of issueIds) {
      const prs = await this.findPrsForIssue<{
        number?: number;
        url: string;
        headRefName?: string;
        baseRefName?: string;
        title: string;
        body: string;
      }>(issueId, "all", "number,url,headRefName,baseRefName,title,body");
      for (const pr of prs) {
        if (!pr.url) continue;
        byUrl.set(pr.url, {
          id: pr.number ? String(pr.number) : pr.url,
          url: pr.url,
          sourceBranch: pr.headRefName ?? "",
          targetBranch: pr.baseRefName ?? "",
        });
      }
    }
    return [...byUrl.values()];
  }

  async readDependencies(input: { issueIds: number[] }): Promise<import("./provider.js").SprintDependency[]> {
    const byKey = new Map<string, import("./provider.js").SprintDependency>();
    const add = (dependency: import("./provider.js").SprintDependency) => {
      const key = `${dependency.blockedIssueId}:${dependency.blockingIssueId}`;
      const existing = byKey.get(key);
      if (!existing || dependency.native) byKey.set(key, dependency);
    };
    for (const issueId of input.issueIds) {
      for (const dependency of await this.readNativeDependenciesForIssue(issueId)) {
        add(dependency);
      }
      const comments = await this.listComments(issueId);
      for (const comment of comments) {
        for (const match of comment.body.matchAll(/#(\d+)\s+blocks\s+#(\d+)/gi)) {
          add({
            blockingIssueId: Number(match[1]),
            blockedIssueId: Number(match[2]),
            native: false,
          });
        }
      }
    }
    return [...byKey.values()];
  }

  private async readNativeDependenciesForIssue(issueId: number): Promise<import("./provider.js").SprintDependency[]> {
    try {
      const raw = await this.gh([
        "api", `repos/:owner/:repo/issues/${issueId}/timeline`,
        "--paginate",
        "-H", "Accept: application/vnd.github+json",
      ]);
      const events = JSON.parse(raw) as unknown[];
      const dependencies: import("./provider.js").SprintDependency[] = [];
      for (const event of events) {
        const record = event as Record<string, unknown>;
        if (record.event !== "blocked_by_added" && record.event !== "blocked_by_removed") continue;
        const blockingIssueId = findIssueNumber(record, issueId);
        if (!blockingIssueId) continue;
        dependencies.push({
          blockedIssueId: issueId,
          blockingIssueId,
          native: true,
        });
      }
      return dependencies;
    } catch {
      return [];
    }
  }

  async closeSprintMilestone(input: { milestoneId: string }): Promise<void> {
    await this.gh([
      "api", `repos/:owner/:repo/milestones/${input.milestoneId}`,
      "--method", "PATCH",
      "--field", "state=closed",
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

  /**
   * Find PRs linked to an issue via GitHub's timeline API (GraphQL).
   * This catches PRs regardless of branch naming convention.
   * Returns null if GraphQL query fails (caller should fall back).
   */
  private async findPrsViaTimeline(
    issueId: number,
    state: "open" | "merged" | "all",
  ): Promise<Array<{ number: number; title: string; body: string; headRefName: string; baseRefName?: string; url: string; mergedAt: string | null; reviewDecision: string | null; state: string; mergeable: string | null }> | null> {
    const repo = await this.getRepoInfo();
    if (!repo) return null;

    try {
      const query = `{
        repository(owner: "${repo.owner}", name: "${repo.name}") {
          issue(number: ${issueId}) {
            timelineItems(itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT], first: 20) {
              nodes {
                __typename
                ... on ConnectedEvent {
                  subject { ... on PullRequest { number title body headRefName baseRefName state url mergedAt reviewDecision mergeable } }
                }
                ... on CrossReferencedEvent {
                  source { ... on PullRequest { number title body headRefName baseRefName state url mergedAt reviewDecision mergeable } }
                }
              }
            }
          }
        }
      }`;

      const raw = await this.gh(["api", "graphql", "-f", `query=${query}`]);
      const data = JSON.parse(raw);
      const nodes = data?.data?.repository?.issue?.timelineItems?.nodes ?? [];

      // Extract PR data from both event types
      const seen = new Set<number>();
      const prs: Array<{ number: number; title: string; body: string; headRefName: string; baseRefName?: string; url: string; mergedAt: string | null; reviewDecision: string | null; state: string; mergeable: string | null }> = [];

      for (const node of nodes) {
        const pr = node.subject ?? node.source;
        if (!pr?.number || !pr?.url) continue; // Not a PR or empty source
        if (seen.has(pr.number)) continue;
        seen.add(pr.number);
        prs.push({
          number: pr.number,
          title: pr.title ?? "",
          body: pr.body ?? "",
          headRefName: pr.headRefName ?? "",
          baseRefName: pr.baseRefName ?? undefined,
          url: pr.url,
          mergedAt: pr.mergedAt ?? null,
          reviewDecision: pr.reviewDecision ?? null,
          state: pr.state ?? "",
          mergeable: pr.mergeable ?? null,
        });
      }

      // Filter by state
      if (state === "open") return prs.filter((pr) => pr.state === "OPEN");
      if (state === "merged") return prs.filter((pr) => pr.state === "MERGED");
      return prs;
    } catch {
      return null; // GraphQL failed — caller should fall back
    }
  }

  /**
   * Find PRs associated with an issue.
   * Primary: GitHub timeline API (convention-free, catches all linked PRs).
   * Fallback: regex matching on branch name / title / body.
   *
   * TYPE CASTING NOTE: The timeline query returns a fixed set of fields
   * (number, title, body, headRefName, state, url, mergedAt, reviewDecision, mergeable).
   * When callers request additional fields via the `fields` parameter (e.g., "mergeable"),
   * we cast the timeline results to T assuming they match. This works because:
   * 1. For common fields (mergeable, reviewDecision), the timeline API provides them.
   * 2. The fallback path (gh pr list) provides ALL requested fields via the fields parameter.
   * If a caller requests a field the timeline API doesn't provide, the fallback ensures it.
   */
  private async findPrsForIssue<T extends { title: string; body: string; headRefName?: string }>(
    issueId: number,
    state: "open" | "merged" | "all",
    fields: string,
  ): Promise<T[]> {
    // Try timeline API first (returns all linked PRs regardless of naming convention)
    const timelinePrs = await this.findPrsViaTimeline(issueId, state);
    if (timelinePrs && timelinePrs.length > 0) {
      // Map timeline results to the expected shape (T includes the requested fields)
      // The timeline query now provides: number, title, body, headRefName, state, url, mergedAt, reviewDecision, mergeable
      return timelinePrs as unknown as T[];
    }

    // Fallback: regex-based matching on branch name / title / body
    try {
      const args = ["pr", "list", "--json", fields, "--limit", "50"];
      if (state !== "all") args.push("--state", state);
      const raw = await this.gh(args);
      if (!raw) return [];
      const prs = JSON.parse(raw) as T[];
      const branchPat = new RegExp(`^(?:fix|feat|feature|chore|bugfix|hotfix|refactor|docs|test)/${issueId}-`);
      const titlePat = new RegExp(`#${issueId}\\b`);

      // Primary: match by branch name
      const byBranch = prs.filter((pr) => pr.headRefName && branchPat.test(pr.headRefName));
      if (byBranch.length > 0) return byBranch;

      // Fallback: word-boundary match in title/body
      return prs.filter((pr) => titlePat.test(pr.title) || titlePat.test(pr.body ?? ""));
    } catch { return []; }
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    await this.gh(["label", "create", name, "--color", color.replace(/^#/, ""), "--force"]);
  }

  async ensureAllStateLabels(): Promise<void> {
    const labels = getStateLabels(this.workflow);
    const colors = getLabelColors(this.workflow);
    for (const label of labels) {
      await this.ensureLabel(label, colors[label]);
    }
  }

  async createIssue(title: string, description: string, label: StateLabel, assignees?: string[]): Promise<Issue> {
    const args = ["issue", "create", "--title", title, "--body", description, "--label", label];
    if (assignees?.length) args.push("--assignee", assignees.join(","));
    const url = await this.gh(args);
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) throw new Error(`Failed to parse issue URL: ${url}`);
    return this.getIssue(parseInt(match[1], 10));
  }

  async listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    try {
      const raw = await this.gh(["issue", "list", "--label", label, "--state", "open", "--json", "number,title,body,labels,state,url"]);
      return (JSON.parse(raw) as GhIssue[]).map(toIssue);
    } catch { return []; }
  }

  async listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]> {
    try {
      const args = ["issue", "list", "--state", opts?.state ?? "open", "--json", "number,title,body,labels,state,url"];
      if (opts?.label) args.push("--label", opts.label);
      const raw = await this.gh(args);
      return (JSON.parse(raw) as GhIssue[]).map(toIssue);
    } catch { return []; }
  }

  async getIssue(issueId: number): Promise<Issue> {
    const raw = await this.gh(["issue", "view", String(issueId), "--json", "number,title,body,labels,state,url"]);
    return toIssue(JSON.parse(raw) as GhIssue);
  }

  async listComments(issueId: number): Promise<IssueComment[]> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/${issueId}/comments`, "--jq", ".[] | {id: .id, author: .user.login, body: .body, created_at: .created_at}"]);
      if (!raw) return [];
      return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch { return []; }
  }

  async transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void> {
    // Two-phase transition to ensure atomicity and recoverability:
    // Phase 1: Add new label first (safer than removing first)
    // Phase 2: Remove old state labels
    // This way, if phase 2 fails, the issue still has the new label (issue is correctly transitioned)
    // instead of having no state label at all.
    
    await this.gh(["issue", "edit", String(issueId), "--add-label", to]);
    
    // Remove old state labels (best-effort if there are multiple old labels)
    const issue = await this.getIssue(issueId);
    const stateLabels = getStateLabels(this.workflow);
    const currentStateLabels = issue.labels.filter((l) => stateLabels.includes(l) && l !== to);
    
    if (currentStateLabels.length > 0) {
      const args = ["issue", "edit", String(issueId)];
      for (const l of currentStateLabels) args.push("--remove-label", l);
      await this.gh(args);
    }

    // Post-transition validation: verify exactly one state label remains (#473)
    try {
      const postIssue = await this.getIssue(issueId);
      const postStateLabels = postIssue.labels.filter((l) => stateLabels.includes(l));
      if (postStateLabels.length !== 1 || !postStateLabels.includes(to)) {
        // Log anomaly but don't throw — transition is already committed
        console.error(
          `[state_transition_anomaly] Issue #${issueId}: expected state "${to}", ` +
          `found ${postStateLabels.length} state label(s): [${postStateLabels.join(", ")}]. ` +
          `Transition: "${from}" → "${to}". See #473.`,
        );
      }
    } catch {
      // Validation is best-effort — don't break the transition
    }
  }

  async addLabel(issueId: number, label: string): Promise<void> {
    await this.gh(["issue", "edit", String(issueId), "--add-label", label]);
  }

  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "edit", String(issueId)];
    for (const l of labels) args.push("--remove-label", l);
    await this.gh(args);
  }

  async closeIssue(issueId: number): Promise<void> { await this.gh(["issue", "close", String(issueId)]); }
  async reopenIssue(issueId: number): Promise<void> { await this.gh(["issue", "reopen", String(issueId)]); }

  async getMergedMRUrl(issueId: number): Promise<string | null> {
    type MergedPr = { title: string; body: string; headRefName: string; url: string; mergedAt: string };
    const prs = await this.findPrsForIssue<MergedPr>(issueId, "merged", "title,body,headRefName,url,mergedAt");
    if (prs.length === 0) return null;
    prs.sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime());
    return prs[0].url;
  }

  async getPrStatus(issueId: number): Promise<PrStatus> {
    // Check open PRs first — include mergeable for conflict detection
    type OpenPr = { title: string; body: string; headRefName: string; baseRefName?: string; url: string; number: number; reviewDecision: string; mergeable: string; statusCheckRollup?: unknown };
    const open = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,baseRefName,url,number,reviewDecision,mergeable,statusCheckRollup");
    if (open.length > 0) {
      const pr = open[0];
      let state: PrState;
      if (pr.reviewDecision === "APPROVED") {
        state = PrState.APPROVED;
      } else if (pr.reviewDecision === "CHANGES_REQUESTED") {
        state = PrState.CHANGES_REQUESTED;
      } else {
        // No branch protection → reviewDecision may be empty. Check individual reviews.
        const hasChangesRequested = await this.hasChangesRequestedReview(pr.number);
        if (hasChangesRequested) {
          state = PrState.CHANGES_REQUESTED;
        } else {
          // Check for unacknowledged COMMENTED reviews (feedback without formal "Request changes")
          const hasReviewFeedback = await this.hasUnacknowledgedReviews(pr.number);
          if (hasReviewFeedback) {
            state = PrState.HAS_COMMENTS;
          } else {
            // Fall through to conversation comment detection
            const hasComments = await this.hasConversationComments(pr.number);
            state = hasComments ? PrState.HAS_COMMENTS : PrState.OPEN;
          }
        }
      }

      // Conflict detection: "CONFLICTING" means merge conflicts, "UNKNOWN" means still computing
      const mergeable = pr.mergeable === "CONFLICTING" ? false
        : pr.mergeable === "MERGEABLE" ? true
        : undefined; // UNKNOWN or missing — don't assume

      return {
        state,
        url: pr.url,
        title: pr.title,
        sourceBranch: pr.headRefName,
        targetBranch: pr.baseRefName,
        baseBranch: pr.baseRefName,
        mergeable,
        checksPassed: checksPassedFromGithubRollup(pr.statusCheckRollup),
      };
    }
    // Check merged PRs — also fetch reviewDecision to detect approved-then-merged vs self-merged.
    type MergedPr = { title: string; body: string; headRefName: string; baseRefName?: string; url: string; reviewDecision: string | null };
    const merged = await this.findPrsForIssue<MergedPr>(issueId, "merged", "title,body,headRefName,baseRefName,url,reviewDecision");
    if (merged.length > 0) {
      const pr = merged[0];
      const state = pr.reviewDecision === "APPROVED" ? PrState.APPROVED : PrState.MERGED;
      return { state, url: pr.url, title: pr.title, sourceBranch: pr.headRefName, targetBranch: pr.baseRefName, baseBranch: pr.baseRefName, checksPassed: true };
    }
    // Check for closed-without-merge PRs. url: non-null = PR was explicitly closed;
    // url: null = no PR has ever been created for this issue.
    const allPrs = await this.findPrsViaTimeline(issueId, "all");
    const closedPr = allPrs?.find((pr) => pr.state === "CLOSED");
    if (closedPr) {
      return { state: PrState.CLOSED, url: closedPr.url, title: closedPr.title, sourceBranch: closedPr.headRefName, targetBranch: closedPr.baseRefName, baseBranch: closedPr.baseRefName };
    }
    return { state: PrState.CLOSED, url: null };
  }

  /**
   * Check individual reviews for CHANGES_REQUESTED state.
   * Used when branch protection is disabled (reviewDecision is empty).
   */
  private async hasChangesRequestedReview(prNumber: number): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/pulls/${prNumber}/reviews`, "--jq",
        "[.[] | select(.state == \"CHANGES_REQUESTED\" or .state == \"APPROVED\") | {user: .user.login, state}] | group_by(.user) | map(sort_by(.state) | last) | .[] | select(.state == \"CHANGES_REQUESTED\") | .user"]);
      return raw.trim().length > 0;
    } catch { return false; }
  }

  /**
   * Check if a PR has unacknowledged COMMENTED reviews from non-bot users.
   * A review is "acknowledged" if it has an 👀 (eyes) reaction.
   * This catches the common case where reviewers submit feedback as "Comment"
   * rather than "Request changes".
   *
   * Note: We don't filter out self-reviews because DevClaw agents commit under
   * the repo owner's account — the PR author and reviewer are the same person.
   */
  private async hasUnacknowledgedReviews(prNumber: number): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/pulls/${prNumber}/reviews`]);
      const reviews = JSON.parse(raw) as Array<{
        id: number; user: { login: string }; body: string; state: string;
      }>;

      // Filter to COMMENTED reviews with non-empty body from non-bot users
      const commentedReviews = reviews.filter(
        (r) => r.state === "COMMENTED" && r.body?.trim().length > 0 &&
          !r.user.login.endsWith("[bot]"),
      );

      if (commentedReviews.length === 0) return false;

      // Check if any are unacknowledged (no 👀 reaction)
      for (const review of commentedReviews) {
        try {
          const reactionsRaw = await this.gh([
            "api", `repos/:owner/:repo/pulls/${prNumber}/reviews/${review.id}/reactions`,
          ]);
          const reactions = JSON.parse(reactionsRaw) as Array<{ content: string }>;
          const hasEyes = reactions.some((r) => r.content === "eyes");
          if (!hasEyes) return true; // Found unacknowledged review
        } catch {
          // Can't check reactions — treat as unacknowledged to be safe
          return true;
        }
      }

      return false;
    } catch { return false; }
  }

  /**
   * Check if a PR has any top-level conversation comments from human users.
   * Excludes only bot accounts ([bot] suffix) and empty bodies.
   * Uses the Issues Comments API (PRs are also issues in GitHub).
   */
  private async hasConversationComments(prNumber: number): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/${prNumber}/comments`]);
      const comments = JSON.parse(raw) as Array<{ user: { login: string }; body: string; reactions: { eyes: number } }>;
      return comments.some(
        (c) => !c.user.login.endsWith("[bot]") && c.body.trim().length > 0 && !(c.reactions?.eyes > 0),
      );
    } catch { return false; }
  }

  /**
   * Fetch top-level conversation comments on a PR from human users.
   * These are comments on the PR timeline (not inline review comments).
   * Excludes only bot accounts and empty bodies.
   */
  private async fetchConversationComments(
    prNumber: number,
  ): Promise<Array<{ id: number; user: { login: string }; body: string; created_at: string }>> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/${prNumber}/comments`]);
      const all = JSON.parse(raw) as Array<{ id: number; user: { login: string }; body: string; created_at: string }>;
      return all.filter(
        (c) => !c.user.login.endsWith("[bot]") && c.body.trim().length > 0,
      );
    } catch { return []; }
  }

  async mergePr(issueId: number): Promise<void> {
    type OpenPr = { title: string; body: string; headRefName: string; url: string };
    const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,url");
    if (prs.length === 0) throw new Error(`No open PR found for issue #${issueId}`);
    await this.gh(["pr", "merge", prs[0].url, "--merge"]);
  }

  async getPrDiff(issueId: number): Promise<string | null> {
    type OpenPr = { title: string; body: string; headRefName: string; number: number };
    const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
    if (prs.length === 0) return null;
    try {
      return await this.gh(["pr", "diff", String(prs[0].number)]);
    } catch { return null; }
  }

  async getPrReviewComments(issueId: number): Promise<PrReviewComment[]> {
    type OpenPr = { title: string; body: string; headRefName: string; number: number };
    const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
    if (prs.length === 0) return [];
    const prNumber = prs[0].number;
    const comments: PrReviewComment[] = [];

    try {
      // Review-level comments (top-level reviews: APPROVED, CHANGES_REQUESTED, COMMENTED)
      const reviewsRaw = await this.gh(["api", `repos/:owner/:repo/pulls/${prNumber}/reviews`]);
      const reviews = JSON.parse(reviewsRaw) as Array<{
        id: number; user: { login: string }; body: string; state: string; submitted_at: string;
      }>;
      for (const r of reviews) {
        if (r.state === "DISMISSED") continue; // Skip dismissed
        if (!r.body && r.state === "COMMENTED") continue; // Skip empty COMMENTED reviews
        comments.push({
          id: r.id,
          author: r.user.login,
          body: r.body ?? "",
          state: r.state,
          created_at: r.submitted_at,
        });
      }
    } catch { /* best-effort */ }

    try {
      // Inline (file-level) review comments
      const inlineRaw = await this.gh(["api", `repos/:owner/:repo/pulls/${prNumber}/comments`]);
      const inlines = JSON.parse(inlineRaw) as Array<{
        id: number; user: { login: string }; body: string; path: string; line: number | null; created_at: string;
      }>;
      for (const c of inlines) {
        comments.push({
          id: c.id,
          author: c.user.login,
          body: c.body,
          state: "INLINE",
          created_at: c.created_at,
          path: c.path,
          line: c.line ?? undefined,
        });
      }
    } catch { /* best-effort */ }

    // Top-level conversation comments (regular PR comments via Issues API)
    const conversationComments = await this.fetchConversationComments(prNumber);
    for (const c of conversationComments) {
      comments.push({
        id: c.id,
        author: c.user.login,
        body: c.body,
        state: "COMMENTED",
        created_at: c.created_at,
      });
    }

    // Sort by date
    comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return comments;
  }

  async addComment(issueId: number, body: string): Promise<number> {
    const raw = await this.gh([
      "api", `repos/:owner/:repo/issues/${issueId}/comments`,
      "--method", "POST",
      "--field", `body=${body}`,
    ]);
    const parsed = JSON.parse(raw) as { id: number };
    return parsed.id;
  }

  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.gh([
        "api", `repos/:owner/:repo/issues/${issueId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/${issueId}/reactions`]);
      const reactions = JSON.parse(raw) as Array<{ content: string }>;
      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      // GitHub PRs are also issues — use the same reactions API with the PR number
      type OpenPr = { title: string; body: string; headRefName: string; number: number };
      const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
      if (prs.length === 0) return;
      await this.gh([
        "api", `repos/:owner/:repo/issues/${prs[0].number}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      type OpenPr = { title: string; body: string; headRefName: string; number: number };
      const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
      if (prs.length === 0) return false;
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/${prs[0].number}/reactions`]);
      const reactions = JSON.parse(raw) as Array<{ content: string }>;
      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async reactToIssueComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.gh([
        "api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /**
   * Add an emoji reaction to a PR/MR issue comment.
   * Uses the GitHub Issues Comments Reactions API (PRs share the issue comment namespace).
   * Best-effort — swallows all errors.
   */
  async reactToPrComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.gh([
        "api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /**
   * Add an emoji reaction to a PR review by its review ID.
   * Uses the GitHub Pull Request Review Reactions API.
   */
  async reactToPrReview(issueId: number, reviewId: number, emoji: string): Promise<void> {
    try {
      // We need the PR number, not the issue ID. Find the PR first.
      type OpenPr = { title: string; body: string; headRefName: string; number: number };
      const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
      if (prs.length === 0) return;
      await this.gh([
        "api", `repos/:owner/:repo/pulls/${prs[0].number}/reviews/${reviewId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`]);
      const reactions = JSON.parse(raw) as Array<{ content: string }>;
      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const raw = await this.gh(["api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`]);
      const reactions = JSON.parse(raw) as Array<{ content: string }>;
      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async prReviewHasReaction(issueId: number, reviewId: number, emoji: string): Promise<boolean> {
    try {
      type OpenPr = { title: string; body: string; headRefName: string; number: number };
      const prs = await this.findPrsForIssue<OpenPr>(issueId, "open", "title,body,headRefName,number");
      if (prs.length === 0) return false;
      const raw = await this.gh([
        "api", `repos/:owner/:repo/pulls/${prs[0].number}/reviews/${reviewId}/reactions`,
      ]);
      const reactions = JSON.parse(raw) as Array<{ content: string }>;
      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue> {
    const args = ["issue", "edit", String(issueId)];
    if (updates.title !== undefined) args.push("--title", updates.title);
    if (updates.body !== undefined) args.push("--body", updates.body);
    await this.gh(args);
    return this.getIssue(issueId);
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches the last 200 commits on baseBranch for commit messages mentioning #issueId.
   * Used as a fallback when no PR exists (e.g., direct commit to main).
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      const result = await this.runCommand(
        ["git", "log", `origin/${baseBranch}`, "--oneline", "-200", "--grep", `#${issueId}`],
        { timeoutMs: 15_000, cwd: this.repoPath },
      );
      return result.stdout.trim().length > 0;
    } catch { return false; }
  }

  async uploadAttachment(
    issueId: number,
    file: { filename: string; buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    try {
      const branch = "devclaw-attachments";
      const safeFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `attachments/${issueId}/${Date.now()}-${safeFilename}`;
      const base64Content = file.buffer.toString("base64");

      // Get repo owner/name
      const repo = await this.getRepoInfo();
      if (!repo) return null;

      // Ensure branch exists
      let branchExists = false;
      try {
        await this.gh(["api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${branch}`]);
        branchExists = true;
      } catch { /* doesn't exist */ }

      if (!branchExists) {
        const raw = await this.gh([
          "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name",
        ]);
        const defaultBranch = raw.trim();
        const shaRaw = await this.gh([
          "api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${defaultBranch}`,
          "--jq", ".object.sha",
        ]);
        await this.gh([
          "api", `repos/${repo.owner}/${repo.name}/git/refs`,
          "--method", "POST",
          "--field", `ref=refs/heads/${branch}`,
          "--field", `sha=${shaRaw.trim()}`,
        ]);
      }

      // Upload via Contents API
      await this.gh([
        "api", `repos/${repo.owner}/${repo.name}/contents/${filePath}`,
        "--method", "PUT",
        "--field", `message=attachment: ${file.filename} for issue #${issueId}`,
        "--field", `content=${base64Content}`,
        "--field", `branch=${branch}`,
      ]);

      return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${filePath}`;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try { await this.gh(["auth", "status"]); return true; } catch { return false; }
  }
}

function findIssueNumber(value: unknown, exclude: number): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value !== exclude) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findIssueNumber(item, exclude);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = record.number ?? record.issue_number;
    if (typeof direct === "number" && Number.isInteger(direct) && direct > 0 && direct !== exclude) return direct;
    for (const nested of Object.values(record)) {
      const found = findIssueNumber(nested, exclude);
      if (found) return found;
    }
  }
  return null;
}

function referencesIssue(body: string, issueId: number): boolean {
  const escaped = String(issueId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\\s+#${escaped}\\b`, "i").test(body);
}
