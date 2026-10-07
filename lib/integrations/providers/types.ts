/**
 * Shared provider-facing DTOs.
 */

import type { ValueOf } from "../../types.js";
import type { PR_COMMENT_KIND, PROVIDER_COMMAND_MODE, PROVIDER_OPERATION_ERROR } from "./const.js";

/** Stable transport category reused by mutation errors. */
export type ProviderOperationErrorCode = ValueOf<typeof PROVIDER_OPERATION_ERROR>;

/** Replay safety explicitly selected for a provider CLI operation. */
export type ProviderCommandMode = ValueOf<typeof PROVIDER_COMMAND_MODE>;

/** Normalized transport evidence, independent of issue lookup or mutation recovery policy. */
export type ProviderTransportFailure = {
  /** Stable failure category. */
  code: ProviderOperationErrorCode;
  /** Whether a read or explicitly idempotent operation can be repeated. */
  retryable: boolean;
  /** Whether a submitted mutation may already have taken effect. */
  outcomeUnknown: boolean;
  /** Confirmed HTTP status when available. */
  status?: number;
};

export type StateLabel = string;

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

export const PrState = {
  OPEN: "open",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  HAS_COMMENTS: "has_comments",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PrState = (typeof PrState)[keyof typeof PrState];

export type PrStatus = {
  state: PrState;
  url: string | null;
  title?: string;
  sourceBranch?: string;
  mergeable?: boolean;
  /** COMMENTED review summaries requiring application-owned local receipt comparison. */
  reviewSummaries?: PrReviewComment[];
  /** Non-summary feedback still observed without the cosmetic acknowledgement indicator. */
  hasCommentFeedback?: boolean;
};

/** Provider review observation with an explicit source namespace for safe acknowledgement. */
export type PrReviewComment = {
  /** Original provider source; independent of approval state or optional file location. */
  kind: ValueOf<typeof PR_COMMENT_KIND>;
  /** Identifier within the source namespace. */
  id: number;
  /** Provider display name of the author. */
  author: string;
  /** Review text supplied to workers. */
  body: string;
  /** Provider review status, independent of the reaction namespace. */
  state: string;
  /** Provider timestamp used to order observations. */
  created_at: string;
  /** Optional file location for inline feedback. */
  path?: string;
  /** Optional line within the referenced file. */
  line?: number;
};
