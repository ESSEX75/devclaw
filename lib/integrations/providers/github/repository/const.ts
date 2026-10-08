/** Owns github/repository const contracts at the concrete provider boundary. */

/** Fields required to confirm and cache repository identity. */
export const GITHUB_REPOSITORY_QUERY = {
  REPOSITORY_FIELDS: "owner,name",
} as const;

/** Repository collection root used with confirmed owner/name identities. */
export const GITHUB_REPOSITORY_RESOURCE = "repos";
