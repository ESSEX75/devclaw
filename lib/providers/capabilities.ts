import type { Issue, IssueComment, PrReviewComment, PrStatus, StateLabel } from "./provider.js";

export type IssueListFilter = {
  label?: string;
  state?: "open" | "closed" | "all";
};

export interface IssueReader {
  listIssuesByLabel(label: StateLabel): Promise<Issue[]>;
  listIssues(opts?: IssueListFilter): Promise<Issue[]>;
  getIssue(issueId: number): Promise<Issue>;
  listComments(issueId: number): Promise<IssueComment[]>;
}

export interface IssueWriter {
  createIssue(title: string, description: string, label: StateLabel, assignees?: string[]): Promise<Issue>;
  closeIssue(issueId: number): Promise<void>;
  reopenIssue(issueId: number): Promise<void>;
  addComment(issueId: number, body: string): Promise<number>;
  editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue>;
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
  getPrStatus(issueId: number): Promise<PrStatus>;
  getPrDiff(issueId: number): Promise<string | null>;
}

export interface PullRequestOperator {
  mergePr(issueId: number): Promise<void>;
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean>;
}

export interface ReviewReader {
  getPrReviewComments(issueId: number): Promise<PrReviewComment[]>;
}

export interface ReactionWriter {
  reactToIssue(issueId: number, emoji: string): Promise<void>;
  issueHasReaction(issueId: number, emoji: string): Promise<boolean>;
  reactToPr(issueId: number, emoji: string): Promise<void>;
  prHasReaction(issueId: number, emoji: string): Promise<boolean>;
  reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  reactToPrReview(issueId: number, reviewId: number, emoji: string): Promise<void>;
  issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  prReviewHasReaction(issueId: number, reviewId: number, emoji: string): Promise<boolean>;
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
