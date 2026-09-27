/** Provider DTO discriminants shared by adapters and application consumers. */

/** Source namespace of PR feedback; numeric IDs are not interchangeable between these sources. */
export const PR_COMMENT_KIND = { REVIEW: "review", INLINE: "inline", CONVERSATION: "conversation" } as const;
