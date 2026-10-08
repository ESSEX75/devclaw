/** Owns github/api endpoints contracts at the concrete provider boundary. */

import { GITHUB_API_ROOT } from "./const.js";

/** Address an explicit resource within the repository/project selected by CLI configuration.
 * @param parts - Resource identifiers and provider-local IDs chosen by the owning capability.
 */
export function githubApiPath(...parts: (string | number)[]): string {
  return [GITHUB_API_ROOT, ...parts].join("/");
}
