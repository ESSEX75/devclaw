/** Defines validated GitHub confirmed repository identity contracts shared with capability consumers. */

/** Confirmed repository identity shared by discovery and attachments. */
export type GitHubRepositoryInfo = {
  /** Provider-confirmed repository owner login. */
  owner: string;
  /** Provider-confirmed repository name. */
  name: string;
};
