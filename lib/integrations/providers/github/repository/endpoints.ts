/** Builds GitHub resource paths from confirmed repository identity without executing provider commands. */

import { GITHUB_REPOSITORY_RESOURCE } from "./const.js";
import type { GitHubRepositoryInfo } from "./types.js";

/** Address the confirmed concrete repository rather than relying on CLI placeholders.
 * @param repository - Provider-confirmed repository identity.
 * @param parts - Explicit resource identifiers and selected branch/file identities.
 */
export function githubRepositoryPath(repository: GitHubRepositoryInfo, ...parts: (string | number)[]): string {
  return [GITHUB_REPOSITORY_RESOURCE, repository.owner, repository.name, ...parts].join("/");
}
