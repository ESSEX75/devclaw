/** Owns github/api const contracts at the concrete provider boundary. */

/** Shared API resource namespaces used across concrete capabilities. */
export const GITHUB_API_RESOURCE = {
  PULLS: "pulls",
  ISSUES: "issues",
  COMMENTS: "comments",
} as const;

/** Repository/project placeholder root understood by the concrete CLI. */
export const GITHUB_API_ROOT = "repos/:owner/:repo";

/** GitHub's confirmed lifecycle observations independent of local workflow states. */
export const GITHUB_REQUEST_STATE = {
  OPEN: "OPEN",
  MERGED: "MERGED",
  CLOSED: "CLOSED",
} as const;
