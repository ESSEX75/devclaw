/** Owns github/repository types contracts at the concrete provider boundary. */

/** Confirmed repository identity shared by discovery and attachments. */
export type GitHubRepositoryInfo = {
  /** Provider-confirmed repository owner login. */
  owner: string;
  /** Provider-confirmed repository name. */
  name: string;
};
