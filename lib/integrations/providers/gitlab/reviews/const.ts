/** Owns gitlab/reviews const contracts at the concrete provider boundary. */

/** Discussion and approval resources owned by review observations. */
export const GITLAB_REVIEW_RESOURCE = {
  DISCUSSIONS: "discussions",
  APPROVALS: "approvals",
} as const;

/** GitLab's explicit inline-note discriminator, independent of optional position fields. */
export const GITLAB_INLINE_NOTE_TYPE = "DiffNote";
