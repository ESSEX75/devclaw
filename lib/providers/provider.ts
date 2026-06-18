/**
 * IssueProvider — Abstract interface for issue tracker operations.
 *
 * Implementations: GitHub (gh CLI), GitLab (glab CLI).
 */

/**
 * StateLabel type — string for flexibility with custom workflows.
 */
export type StateLabel = string;

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export type Issue = {
  iid: number;
  providerId?: number;
  title: string;
  description: string;
  labels: string[];
  state: string;
  web_url: string;
};

export type IssueComment = {
  id: number;
  author: string;
  body: string;
  created_at: string;
};

/** Built-in PR states. */
export const PrState = {
  OPEN: "open",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  /** PR/MR is open with no formal review state, but has top-level comments from non-authors. */
  HAS_COMMENTS: "has_comments",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
export type PrState = (typeof PrState)[keyof typeof PrState];

export type PrStatus = {
  state: PrState;
  url: string | null;
  /** MR/PR title (e.g. "feat: add login page"). */
  title?: string;
  /** Source branch name (e.g. "feature/7-blog-cms"). */
  sourceBranch?: string;
  /** Target/base branch name of the PR/MR. */
  targetBranch?: string;
  /** Alias for providers that call the target branch a base branch. */
  baseBranch?: string;
  /** false = has merge conflicts. undefined = unknown or not applicable. */
  mergeable?: boolean;
  /** true when provider checks are known passing; false when failing; undefined when unknown. */
  checksPassed?: boolean;
};

/** A review comment on a PR/MR. */
export type PrReviewComment = {
  id: number;
  author: string;
  body: string;
  /** "APPROVED", "CHANGES_REQUESTED", "COMMENTED" */
  state: string;
  created_at: string;
  /** File path for inline comments. */
  path?: string;
  /** Line number for inline comments. */
  line?: number;
};

// ---------------------------------------------------------------------------
// Sprint readiness types
// ---------------------------------------------------------------------------

export type SprintProviderCapabilities = {
  issues: boolean;
  milestones: boolean;
  branches: boolean;
  pullRequests: boolean;
  autoMerge: boolean;
  nativeSubIssues: boolean;
  nativeDependencies: boolean;
};

export type SprintReadinessCheck = {
  code:
    | "provider_auth"
    | "provider_permissions"
    | "repository_not_found"
    | "base_branch_missing"
    | "missing_sprint_capability"
    | "auto_merge_blocked"
    | "native_sub_issues_unavailable"
    | "native_dependencies_unavailable"
    | "optional_labels_need_normalization"
    | "provider_unavailable";
  message: string;
  details?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Sprint projection types
// ---------------------------------------------------------------------------

export type SprintMilestone = {
  id: string;
  title: string;
  url?: string;
};

export type SprintBranch = {
  name: string;
  base: string;
  url?: string;
};

export type SprintPullRequest = {
  id: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
};

export type SprintDependency = {
  blockedIssueId: number;
  blockingIssueId: number;
  native: boolean;
};

export type SprintTree = {
  milestone?: SprintMilestone;
  rootIssue: Issue;
  childIssues: Issue[];
  dependencies: SprintDependency[];
  pullRequests: SprintPullRequest[];
};

export type ManagedProjectionGuardResult = {
  ok: boolean;
  repaired: string[];
  integrityErrors: string[];
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface IssueProvider {
  getSprintCapabilities(): Promise<SprintProviderCapabilities>;
  checkSprintReadiness(opts: { baseBranch: string; reviewPolicy?: string }): Promise<{
    blocking: SprintReadinessCheck[];
    warnings: SprintReadinessCheck[];
  }>;
  createSprintMilestone(input: { title: string; description?: string }): Promise<SprintMilestone>;
  createSprintRoot(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue>;
  createChildIssue(input: {
    title: string;
    body: string;
    milestoneId?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue>;
  linkChildIssue(input: { rootIssueId: number; childIssueId: number }): Promise<void>;
  linkIssueDependency(input: { blockedIssueId: number; blockingIssueId: number }): Promise<void>;
  assignIssue(input: { issueId: number; assignees: string[] }): Promise<void>;
  createSprintBranch(input: { branch: string; fromBranch: string }): Promise<SprintBranch>;
  createWorkBranch(input: { branch: string; fromBranch: string }): Promise<SprintBranch>;
  createPullRequest(input: {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
    issueId?: number;
  }): Promise<SprintPullRequest>;
  linkPullRequestToIssue(input: { issueId: number; pullRequestId: string; pullRequestUrl: string }): Promise<void>;
  readSprintTree(input: { rootIssueId: number }): Promise<SprintTree>;
  readDependencies(input: { issueIds: number[] }): Promise<SprintDependency[]>;
  closeSprintMilestone(input: { milestoneId: string }): Promise<void>;
  guardManagedProjection(input: {
    rootIssueId: number;
    expectedMetadata: Record<string, unknown>;
    repair?: boolean;
  }): Promise<ManagedProjectionGuardResult>;
  ensureLabel(name: string, color: string): Promise<void>;
  ensureAllStateLabels(): Promise<void>;
  createIssue(title: string, description: string, label: StateLabel, assignees?: string[]): Promise<Issue>;
  listIssuesByLabel(label: StateLabel): Promise<Issue[]>;
  /** List issues with optional filters. Provider-agnostic — future Jira/Linear/Trello can map to native queries. */
  listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]>;
  getIssue(issueId: number): Promise<Issue>;
  listComments(issueId: number): Promise<IssueComment[]>;
  transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void>;
  addLabel(issueId: number, label: string): Promise<void>;
  removeLabels(issueId: number, labels: string[]): Promise<void>;
  closeIssue(issueId: number): Promise<void>;
  reopenIssue(issueId: number): Promise<void>;
  getMergedMRUrl(issueId: number): Promise<string | null>;
  getPrStatus(issueId: number): Promise<PrStatus>;
  mergePr(issueId: number): Promise<void>;
  getPrDiff(issueId: number): Promise<string | null>;
  /** Get review comments on the PR linked to an issue. */
  getPrReviewComments(issueId: number): Promise<PrReviewComment[]>;
  /**
   * Check if work for an issue is already present on the base branch via git history.
   * Used as a fallback when no PR exists (e.g., work committed directly to main).
   * Searches recent git log on the base branch for commits mentioning issue #N or !N.
   * @param issueId  Issue number to search for
   * @param baseBranch  Branch to search (e.g. "main")
   */
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean>;
  /**
   * Add an emoji reaction to a PR/MR comment by its comment ID.
   * Best-effort — implementations should not throw.
   * @param issueId  Issue ID (used to locate the associated PR/MR)
   * @param commentId  The numeric ID of the comment to react to
   * @param emoji  Reaction name understood by the provider (e.g. "rocket", "+1")
   */
  /**
   * Add an emoji reaction to an issue comment by its comment ID.
   * Best-effort — implementations should not throw.
   */
  /**
   * Add an emoji reaction to the issue body itself (not a comment).
   * Used to mark issues as "managed by DevClaw" — presence of 👀 on the
   * issue body distinguishes new-style issues from legacy ones.
   * Best-effort — implementations should not throw.
   */
  reactToIssue(issueId: number, emoji: string): Promise<void>;
  /**
   * Check if the issue body has a specific emoji reaction.
   * Returns false on error (best-effort).
   */
  issueHasReaction(issueId: number, emoji: string): Promise<boolean>;
  /**
   * Add an emoji reaction to the PR/MR body linked to an issue.
   * Best-effort — implementations should not throw.
   */
  reactToPr(issueId: number, emoji: string): Promise<void>;
  /**
   * Check if the PR/MR linked to an issue has a specific emoji reaction.
   * Returns false on error (best-effort).
   */
  prHasReaction(issueId: number, emoji: string): Promise<boolean>;
  reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  /**
   * Add an emoji reaction to a PR review (not a comment) by its review ID.
   * Best-effort — implementations should not throw.
   */
  reactToPrReview(issueId: number, reviewId: number, emoji: string): Promise<void>;
  /**
   * Check if an issue comment has a specific emoji reaction.
   * Returns false on error (best-effort).
   */
  issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  /**
   * Check if a PR comment has a specific emoji reaction.
   * Returns false on error (best-effort).
   */
  prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  /**
   * Check if a PR review has a specific emoji reaction.
   * Returns false on error (best-effort).
   */
  prReviewHasReaction(issueId: number, reviewId: number, emoji: string): Promise<boolean>;
  /** Add a comment to an issue. Returns the new comment's ID. */
  addComment(issueId: number, body: string): Promise<number>;
  editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue>;
  /**
   * Upload a file attachment and return a public URL for embedding in issues.
   * Returns null if the provider doesn't support uploads or the upload fails.
   *
   * GitHub: commits file to a `devclaw-attachments` branch, returns raw URL.
   * GitLab: uses the native project uploads API.
   */
  uploadAttachment(issueId: number, file: {
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string | null>;
  healthCheck(): Promise<boolean>;
}
