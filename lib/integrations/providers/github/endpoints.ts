/** Builds github resource paths while retaining CLI repository/project placeholder resolution. */

import { GITHUB_API_ROOT, GITHUB_REPOSITORY_RESOURCE } from "./const.js";
import type { GitHubRepositoryInfo } from "./types.js";

/** Address an explicit resource within the repository/project selected by CLI configuration.
 * @param parts - Resource identifiers and provider-local IDs chosen by the owning capability.
 */
export function githubApiPath(...parts: (string | number)[]): string {
  return [GITHUB_API_ROOT, ...parts].join("/");
}

/** Address the confirmed concrete repository rather than relying on CLI placeholders.
 * @param repository - Provider-confirmed repository identity.
 * @param parts - Explicit resource identifiers and selected branch/file identities.
 */
export function githubRepositoryPath(repository: GitHubRepositoryInfo, ...parts: (string | number)[]): string {
  return [GITHUB_REPOSITORY_RESOURCE, repository.owner, repository.name, ...parts].join("/");
}
