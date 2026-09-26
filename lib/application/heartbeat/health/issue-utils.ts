/** Provider observations used by health diagnosis without inferring deletion from transport errors. */
import type { WorkflowConfig } from "../../../domain/index.js";
import { getQueueLabels, isFeedbackState } from "../../../domain/index.js";
import { isProviderIssueLookupError, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../../integrations/providers/lookup-errors.js";
import type { Issue,IssueProvider, StateLabel } from "../../../integrations/providers/provider.js";
import { PrState } from "../../../integrations/providers/provider.js";

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

/** Check if an issue is closed (GitHub returns "CLOSED", GitLab returns "closed"). */
export function isIssueClosed(issue: Issue): boolean {
  return issue.state.toLowerCase() === "closed";
}

/**
 * Determine the correct revert label for an orphaned issue.
 *
 * If the issue has an open PR with feedback (changes requested, comments),
 * revert to the feedback queue ("To Improve") instead of the default queue ("To Do").
 */
export async function resolveOrphanRevertLabel(
  provider: IssueProvider,
  issueId: number,
  role: string,
  defaultQueueLabel: StateLabel,
  workflow: WorkflowConfig,
): Promise<StateLabel> {
  try {
    const prStatus = await provider.getPrStatus(issueId);

    if (prStatus.url && (
      prStatus.state === PrState.OPEN ||
      prStatus.state === PrState.APPROVED ||
      prStatus.state === PrState.CHANGES_REQUESTED ||
      prStatus.state === PrState.HAS_COMMENTS
    )) {
      const queueLabels = getQueueLabels(workflow, role);
      const feedbackLabel = queueLabels.find((l) => isFeedbackState(workflow, l));

      if (feedbackLabel) return feedbackLabel;
    }
  } catch {
    // Best-effort — fall back to default queue on API failure.
  }

  return defaultQueueLabel;
}
