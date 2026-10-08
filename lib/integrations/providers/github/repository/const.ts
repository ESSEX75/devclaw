/** Owns GitHub confirmed repository identity identifiers and policies used by this capability. */

/** Fields required to confirm and cache repository identity. */
export const GITHUB_REPOSITORY_QUERY = {
  REPOSITORY_FIELDS: "owner,name",
} as const;

/** Repository collection root used with confirmed owner/name identities. */
export const GITHUB_REPOSITORY_RESOURCE = "repos";
