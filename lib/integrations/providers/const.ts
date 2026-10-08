/** Holds remaining Git-history and attachment policies until their capability boundaries migrate. */

/** Remote tracking namespace inspected by the direct-commit observation. */
export const PROVIDER_HISTORY_REMOTE = "origin";

/** Git history output contains only confirmed matching commit identifiers. */
export const PROVIDER_HISTORY_FORMAT = "%H";

/** Isolated upload staging resources; display names never become directory paths. */
export const PROVIDER_ATTACHMENT_STORAGE = {
  FALLBACK_NAME: "file",
  MAX_NAME_LENGTH: 180,
} as const;
