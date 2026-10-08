/** Owns exact known-origin host registries for automatic provider selection. */


/** Known GitHub origin hosts; other hosts require explicit provider selection. */
export const GITHUB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["github.com", "ssh.github.com"]);

/** Known GitLab origin hosts; self-hosted installations require explicit selection. */
export const GITLAB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["gitlab.com"]);
