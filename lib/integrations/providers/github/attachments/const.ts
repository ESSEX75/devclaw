/** Owns GitHub attachment publication identifiers and policies used by this capability. */

/** Branch and object selectors used to create attachment storage. */
export const GITHUB_ATTACHMENT_QUERY = {
  DEFAULT_BRANCH_FIELD: "defaultBranchRef",
  DEFAULT_BRANCH_SELECTOR: ".defaultBranchRef.name",
  OBJECT_SHA_SELECTOR: ".object.sha",
} as const;

/** Git reference and contents endpoints owned by attachment publication. */
export const GITHUB_ATTACHMENT_RESOURCE = {
  GIT: "git",
  REF: "ref",
  HEADS: "heads",
  REFS: "refs",
  CONTENTS: "contents",
} as const;

/** Repository resources used to publish uniquely identified attachments. */
export const GITHUB_ATTACHMENT_STORAGE = {
  BRANCH: "devclaw-attachments",
  DIRECTORY: "attachments",
} as const;

/** Exact object identity returned by the GitHub Contents API. */
export const GITHUB_OBJECT_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;
