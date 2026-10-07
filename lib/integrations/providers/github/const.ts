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
