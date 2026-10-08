/** Maps validated GitHub issue observations into provider-neutral DTOs. */

import type { Issue } from "../../contracts/index.js";
import type { GhIssue } from "./types.js";

/** Normalize an already validated issue without changing provider identity.
 * @param gh - Validated GitHub issue fields.
 */
export function toIssue(gh: GhIssue): Issue {
  return {
    iid: gh.number, title: gh.title, description: gh.body ?? "",
    labels: gh.labels.map((l) => l.name), state: gh.state, web_url: gh.url,
  };
}
