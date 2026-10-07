/** Owns concrete github protocol fields and resource identifiers. */

/** GitHub PR fields shared by status, diff, merge and feedback discovery. */
export const GITHUB_PR_FIELDS = "number,title,body,headRefName,url,state,mergedAt,reviewDecision,mergeable";

/** Login suffix identifying provider bot accounts in GitHub review observations. */
export const GITHUB_REVIEW_BOT_SUFFIX = "[bot]";

/** Repository resources used to publish uniquely identified attachments. */
export const GITHUB_ATTACHMENT_STORAGE = {
  BRANCH: "devclaw-attachments",
  DIRECTORY: "attachments",
} as const;

/** Repository/project placeholder root understood by the concrete CLI. */
export const GITHUB_API_ROOT = "repos/:owner/:repo";

/** API resource identifiers shared by concrete capabilities. */
export const GITHUB_API_RESOURCE = {
  GIT: "git",
  REF: "ref",
  HEADS: "heads",
  REFS: "refs",
  CONTENTS: "contents",
  PULLS: "pulls",
  ISSUES: "issues",
  COMMENTS: "comments",
  REACTIONS: "reactions",
  REVIEWS: "reviews",
} as const;

/** Repository collection root used with confirmed owner/name identities. */
export const GITHUB_REPOSITORY_RESOURCE = "repos";

/** Non-repository endpoints and field selectors understood by GitHub CLI/API. */
export const GITHUB_QUERY = {
  GRAPHQL: "graphql",
  RATE_LIMIT: "rate_limit",
  ISSUE_FIELDS: "number,title,body,labels,state,url",
  REPOSITORY_FIELDS: "owner,name",
  REPOSITORY_NAME_FIELD: "name",
  DEFAULT_BRANCH_FIELD: "defaultBranchRef",
  DEFAULT_BRANCH_SELECTOR: ".defaultBranchRef.name",
  OBJECT_SHA_SELECTOR: ".object.sha",
} as const;

/** GitHub's confirmed lifecycle observations independent of local workflow states. */
export const GITHUB_REQUEST_STATE = {
  OPEN: "OPEN",
  MERGED: "MERGED",
  CLOSED: "CLOSED",
} as const;

/** GitHub's explicit mergeability observations. */
export const GITHUB_MERGEABILITY = {
  CONFLICTING: "CONFLICTING",
  MERGEABLE: "MERGEABLE",
} as const;

/** Exact object identity returned by the GitHub Contents API. */
export const GITHUB_OBJECT_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

/** Native/fallback discovery filters used consistently across request capabilities. */
export const GITHUB_DISCOVERY_STATE = {
  OPEN: "open",
  MERGED: "merged",
  ALL: "all",
} as const;

/** GitHub rate-limit reset timestamps are expressed in epoch seconds. */
export const GITHUB_EPOCH_SECOND_MS = 1_000;
