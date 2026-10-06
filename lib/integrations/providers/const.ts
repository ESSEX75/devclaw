/** Provider DTO discriminants shared by adapters and application consumers. */

/** Source namespace of PR feedback; numeric IDs are not interchangeable between these sources. */
export const PR_COMMENT_KIND = { REVIEW: "review", INLINE: "inline", CONVERSATION: "conversation" } as const;

/** Canonical issue state used when comparing provider values without regard to case. */
export const PROVIDER_ISSUE_STATE = { CLOSED: "closed" } as const;
