/** Owns github/issues const contracts at the concrete provider boundary. */

/** Issue observation and repository-access probe selectors. */
export const GITHUB_ISSUE_QUERY = {
  ISSUE_FIELDS: "number,title,body,labels,state,url",
  REPOSITORY_NAME_FIELD: "name",
} as const;
