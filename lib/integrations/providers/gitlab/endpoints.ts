/** Builds gitlab resource paths while retaining CLI repository/project placeholder resolution. */

import { GITLAB_API_ROOT } from "./const.js";

/** Address an explicit resource within the repository/project selected by CLI configuration.
 * @param parts - Resource identifiers and provider-local IDs chosen by the owning capability.
 */
export function gitlabApiPath(...parts: (string | number)[]): string {
  return [GITLAB_API_ROOT, ...parts].join("/");
}
