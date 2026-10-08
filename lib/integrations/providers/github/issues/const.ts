/** Owns GitHub issue observations and explicit mutations identifiers and policies used by this capability. */

/** Issue observation and repository-access probe selectors. */
export const GITHUB_ISSUE_QUERY = {
  ISSUE_FIELDS: "number,title,body,labels,state,url",
  REPOSITORY_NAME_FIELD: "name",
} as const;
