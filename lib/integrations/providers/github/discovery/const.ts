/** Owns GitHub associated request discovery identifiers and policies used by this capability. */

/** GraphQL selector used for complete associated-request discovery. */
export const GITHUB_DISCOVERY_QUERY = {
  GRAPHQL: "graphql",
} as const;

/** GitHub PR fields shared by status, diff, merge and feedback discovery. */
export const GITHUB_PR_FIELDS = "number,title,body,headRefName,url,state,mergedAt,reviewDecision,mergeable";

/** Native/fallback discovery filters used consistently across request capabilities. */
export const GITHUB_DISCOVERY_STATE = {
  OPEN: "open",
  MERGED: "merged",
  ALL: "all",
} as const;
