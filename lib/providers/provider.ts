/**
 * IssueProvider — Abstract interface for issue tracker operations.
 *
 * Implementations: GitHub (gh CLI), GitLab (glab CLI).
 */
import type {
  AttachmentUploader,
  IssueReader,
  IssueWriter,
  LabelProjector,
  ProviderHealthCheck,
  PullRequestOperator,
  PullRequestReader,
  ReactionWriter,
  ReviewReader,
} from "./capabilities.js";

/**
 * StateLabel type — string for flexibility with custom workflows.
 */
export type StateLabel = string;

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export type Issue = {
  iid: number;
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
  /** false = has merge conflicts. undefined = unknown or not applicable. */
  mergeable?: boolean;
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
// Provider facade
// ---------------------------------------------------------------------------

export interface IssueProvider
  extends IssueReader,
    IssueWriter,
    LabelProjector,
    ReviewReader,
    PullRequestReader,
    PullRequestOperator,
    ReactionWriter,
    AttachmentUploader,
    ProviderHealthCheck {}
