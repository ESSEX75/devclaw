/** Owns normalized provider observation and collection discriminants. */


/** Source namespace of PR feedback; numeric IDs are not interchangeable between these sources. */
export const PR_COMMENT_KIND = {
  REVIEW: "review",
  INLINE: "inline",
  CONVERSATION: "conversation",
} as const;

/** Canonical issue state used when comparing provider values without regard to case. */
export const PROVIDER_ISSUE_STATE = {
  CLOSED: "closed",
} as const;

/** Provider review decisions consumed independently of their source namespace. */
export const PROVIDER_REVIEW_STATE = {
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  COMMENTED: "COMMENTED",
  DISMISSED: "DISMISSED",
} as const;

/** Provider-neutral lifecycle and review observation states. */
export const PR_STATE = {
  OPEN: "open",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  HAS_COMMENTS: "has_comments",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

/** Non-formal feedback kinds retained in normalized provider comment state. */
export const PROVIDER_FEEDBACK_STATE = {
  INLINE: "INLINE",
  UNRESOLVED: "UNRESOLVED",
} as const;

/** Provider-side collection filters, independent of configured workflow labels. */
export const PROVIDER_COLLECTION_STATE = {
  OPEN: "open",
  CLOSED: "closed",
  ALL: "all",
} as const;
