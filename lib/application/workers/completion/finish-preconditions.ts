/** Validates current PR evidence; audit history never authorizes completion or bypasses a conflict. */

import { type IssueProvider, PR_STATE } from "../../../integrations/providers/index.js";
import { EYES_EMOJI } from "../../review/index.js";

/** Require a live reviewable PR and reject current conflicts; lookup failures propagate unchanged.
 * The provider is already scoped to this project and issue. Reactions are cosmetic.
 * @param provider - Project-scoped provider capability.
 * @param issueId - Issue currently assigned to the completing worker.
 * @param prUrl - Optional exact request reported by that worker.
 */
export async function validateFinishPullRequest(provider: IssueProvider, issueId: number, prUrl?: string): Promise<void> {
  const status = await provider.getPrStatus(issueId, prUrl);

  if (!status.url || status.state === PR_STATE.CLOSED || status.state === PR_STATE.MERGED) {
    throw new Error(`Cannot mark work_finish(done) without an open PR for issue #${issueId}. Create a PR referencing the issue without closing keywords, then retry.`);
  }

  if (status.mergeable === false) {
    throw new Error(`Cannot complete work_finish(done) while PR still shows merge conflicts: ${status.url}. `
      + "Push the resolved branch and verify the provider state before retrying.");
  }

  try {
    if (!await provider.prHasReaction(issueId, EYES_EMOJI)) await provider.reactToPr(issueId, EYES_EMOJI);
  } catch { /* Cosmetic marker does not authorize or block completion. */ }
}
