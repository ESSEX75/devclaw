/** Selects locally eligible queue candidates before provider or creation reads. */

import { ISSUE_INTEGRITY_STATUS, type IssueRuntimeState } from "../../domain/index.js";
import { queuePolicyBlock } from "./policy.js";

/**
 * Select healthy, owned issues in stable issue-id priority order.
 * Creation readiness and provider availability remain I/O checks in the scanner.
 * @param states - Authoritative active runtime state snapshot.
 * @param queueLabels - Workflow labels eligible for the requested role.
 * @param instanceName - Optional local owner identity restricting selection.
 * @param role - Role evaluated against each issue's saved policy before priority selection.
 */
export function selectLocalQueueCandidates(
  states: readonly IssueRuntimeState[],
  queueLabels: readonly string[],
  instanceName: string | undefined,
  role: string,
): IssueRuntimeState[] {
  return states
    .filter((state) => state.integrityStatus !== ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
      && state.providerMissing === null
      && !state.activeWorker
      && !state.pendingWorkerRelease
      && queuePolicyBlock(state, role) === null
      && queueLabels.includes(state.workflowLabel)
      && (!instanceName || state.owner === null || state.owner === instanceName))
    .sort((a, b) => a.issueId - b.issueId);
}
