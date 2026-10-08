/** Provider DTO discriminants shared by adapters and application consumers. */

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

/** Known GitHub origin hosts; other hosts require explicit provider selection. */
export const GITHUB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["github.com", "ssh.github.com"]);

/** Known GitLab origin hosts; self-hosted installations require explicit selection. */
export const GITLAB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["gitlab.com"]);

/** Remote tracking namespace inspected by the direct-commit observation. */
export const PROVIDER_HISTORY_REMOTE = "origin";

/** Git history output contains only confirmed matching commit identifiers. */
export const PROVIDER_HISTORY_FORMAT = "%H";

/** Provider review decisions consumed independently of their source namespace. */
export const PROVIDER_REVIEW_STATE = {
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  COMMENTED: "COMMENTED",
  DISMISSED: "DISMISSED",
} as const;

/** Isolated upload staging resources; display names never become directory paths. */
export const PROVIDER_ATTACHMENT_STORAGE = {
  FALLBACK_NAME: "file",
  MAX_NAME_LENGTH: 180,
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
