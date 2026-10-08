/** Provider observations used by health diagnosis without inferring deletion from transport errors. */

import type { Issue, IssueProvider } from "../../../integrations/providers/index.js";
import { isProviderIssueLookupError, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../../integrations/providers/index.js";


/**
 * Fetch current issue state from the provider.
 * Returns null only for confirmed absence; authorization and transport errors propagate.
 * @param provider - Provider whose typed lookup outcome is inspected.
 * @param issueId - Issue to observe without mutation.
 */
export async function fetchIssue(
  provider: IssueProvider,
  issueId: number,
): Promise<Issue | null> {
  try {
    return await provider.getIssue(issueId);
  } catch (error) {
    if (isProviderIssueLookupError(error) && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) return null;
    throw error;
  }
}
