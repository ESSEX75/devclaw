/** Owns gitlab/api const contracts at the concrete provider boundary. */

/** Shared issue/request/note namespaces used across concrete capabilities. */
export const GITLAB_API_RESOURCE = {
  ISSUES: "issues",
  MERGE_REQUESTS: "merge_requests",
  NOTES: "notes",
} as const;

/** Repository/project placeholder root understood by the concrete CLI. */
export const GITLAB_API_ROOT = "projects/:id";

/** GitLab lifecycle values, distinct from application workflow states. */
export const GITLAB_REQUEST_STATE = {
  OPEN: "opened",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
