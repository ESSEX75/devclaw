/**
 * Shared provider-facing DTOs.
 */

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
};

export type PrReviewComment = {
  id: number;
  author: string;
  body: string;
  state: string;
  created_at: string;
  path?: string;
  line?: number;
};
