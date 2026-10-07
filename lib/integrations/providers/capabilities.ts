import type { Issue, IssueComment, PrReviewComment, PrStatus, StateLabel } from "./types.js";

export type IssueListFilter = {
  label?: string;
  state?: "open" | "closed" | "all";
};

/** Complete provider issue payload used by transactional creation. */
export type CreateIssueInput = {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
};

export interface IssueReader {
  listIssuesByLabel(label: StateLabel): Promise<Issue[]>;
  listIssues(opts?: IssueListFilter): Promise<Issue[]>;
  getIssue(issueId: number): Promise<Issue>;
  listComments(issueId: number): Promise<IssueComment[]>;
}

export interface IssueWriter {
  createIssue(input: CreateIssueInput): Promise<Issue>;
  closeIssue(issueId: number): Promise<void>;
  reopenIssue(issueId: number): Promise<void>;
  addComment(issueId: number, body: string): Promise<number>;
  editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue>;
}

/** Destructive provider capability used only by the confirmed issue-delete use case. */
export interface IssueDeleter {
  /** Whether this adapter has an explicit provider deletion implementation. */
  supportsIssueDeletion(): boolean;
  /** Permanently delete one provider issue. */
  deleteIssue(issueId: number): Promise<void>;
}

export interface LabelProjector {
  ensureLabel(name: string, color: string): Promise<void>;
  ensureAllStateLabels(): Promise<void>;
  transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void>;
  addLabel(issueId: number, label: string): Promise<void>;
  removeLabels(issueId: number, labels: string[]): Promise<void>;
}

export interface PullRequestReader {
  getMergedMRUrl(issueId: number): Promise<string | null>;
  /** Observe the exact previously selected request, or choose deterministically when no target is supplied.
   * @param issueId - Managed issue whose associated request is inspected.
   * @param prUrl - Optional exact request URL; unavailable targets are failed observations.
   */
  getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus>;
  /** Read the selected request's diff; an unavailable explicit target never redirects to another PR.
   * @param issueId - Managed issue whose associated request is inspected.
   * @param prUrl - Optional exact URL from a previous status observation.
   */
  getPrDiff(issueId: number, prUrl?: string): Promise<string | null>;
}

export interface PullRequestOperator {
  /** Merge the selected request once, preserving an application-supplied exact target.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact request URL; missing targets fail before mutation.
   */
  mergePr(issueId: number, prUrl?: string): Promise<void>;
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean>;
}

export interface ReviewReader {
  /** Read all feedback for one selected request without mixing observations from another PR.
   * @param issueId - Managed issue whose feedback is requested.
   * @param prUrl - Optional exact request URL observed by application orchestration.
   */
  getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]>;
}

export interface ReactionWriter {
  reactToIssue(issueId: number, emoji: string): Promise<void>;
  issueHasReaction(issueId: number, emoji: string): Promise<boolean>;
  reactToPr(issueId: number, emoji: string): Promise<void>;
  prHasReaction(issueId: number, emoji: string): Promise<boolean>;
  reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  /** React to an inline review comment using its provider comment namespace.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  reactToPrReviewComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  /** Check whether an inline review comment already carries the requested reaction.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  prReviewCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
}

export interface AttachmentUploader {
  uploadAttachment(issueId: number, file: {
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string | null>;
}

export interface ProviderHealthCheck {
  healthCheck(): Promise<boolean>;
}

/** Current provider request budget when the adapter can query it safely. */
export type ProviderRateLimitStatus = {
  /** Requests remaining in the relevant provider budget. */
  remaining: number;
  /** ISO reset time when exposed by the provider. */
  resetAt?: string;
};

/** Optional quota preflight used by explicitly planned mutations. */
export interface ProviderRateLimitReader {
  getRateLimitStatus?(): Promise<ProviderRateLimitStatus>;
}
