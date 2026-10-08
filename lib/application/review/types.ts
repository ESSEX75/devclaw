/** Narrow provider capabilities and owned worker review-context contracts. */

import type { PrReviewComment, PullRequestReader, ReactionWriter, ReviewReader } from "../../integrations/providers/index.js";
import type { ValueOf } from "../../types.js";
import type { PR_FEEDBACK_REASON } from "./const.js";

/** Context selection reason independent of provider-specific review status strings. */
export type PrFeedbackReason = ValueOf<typeof PR_FEEDBACK_REASON>;

/** Exact managed issue whose local review-summary receipts can be inspected or updated. */
export type ReviewIssueContext = {
  /** Workspace containing the authoritative issue record. */
  workspaceDir: string;
  /** Canonical project containing the issue. */
  projectSlug: string;
};

/** Provider comment content and explicit reaction namespace retained in the worker message. */
type FeedbackComment = Omit<PrReviewComment, "created_at">;

/** Existing pull request and feedback supplied to a returning worker. */
export type PrFeedback = {
  /** Existing PR that owns this feedback. */
  url: string;
  /** Source branch supplied by the provider, absent when unknown. */
  branchName?: string;
  /** Why this PR needs attention. */
  reason?: PrFeedbackReason;
  /** Included review observations; conflicts may have no comments. */
  comments: FeedbackComment[];
};

/** Existing PR identity and optional code diff for reviewer context. */
export type PrContext = {
  /** Existing PR selected by the provider. */
  url: string;
  /** Diff when available; an unavailable diff does not discard the PR identity. */
  diff?: string;
};

/** Read-only capability used when collecting returning-worker feedback. */
export type FeedbackProvider = Pick<PullRequestReader, "getPrStatus"> & ReviewReader;

/** Read-only capability used when collecting reviewer context. */
export type ContextProvider = Pick<PullRequestReader, "getPrStatus" | "getPrDiff">;

/** Supported comment-reaction operations; review summaries have no REST reaction target. */
export type AcknowledgementProvider = Pick<ReactionWriter,
  "issueCommentHasReaction" | "reactToIssueComment" | "prCommentHasReaction" | "reactToPrComment"
  | "prReviewCommentHasReaction" | "reactToPrReviewComment">;
