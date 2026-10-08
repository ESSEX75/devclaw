/** Reads queue candidates from authoritative local state; provider failures remain visible. */

import type { WorkflowConfig } from "../../domain/index.js";
import { getQueueLabels } from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/index.js";
import { isIssueCreationReady, readIssueStateStore, readWorkerDeliveryResolution } from "../../state/index.js";
import { selectLocalQueueCandidates } from "./select.js";
import type { QueueCandidate, QueueStateLocation } from "./types.js";

/** Find the first eligible managed issue without reading provider routing labels.
 * Provider lookup failures propagate unchanged, including confirmed issue absence.
 * @param provider - Issue content lookup capability.
 * @param role - Configured role whose queues are scanned.
 * @param workflow - Resolved state machine defining the role queues.
 * @param instanceName - Optional local ownership restriction.
 * @param localState - Canonical project storage location.
 */
export async function findNextIssueForRole(
  provider: Pick<IssueReader, "getIssue">,
  role: string,
  workflow: WorkflowConfig,
  instanceName: string | undefined,
  localState: QueueStateLocation,
): Promise<QueueCandidate | null> {
  const { workspaceDir, projectSlug } = localState;
  const store = await readIssueStateStore(workspaceDir, projectSlug);
  const candidates = selectLocalQueueCandidates(Object.values(store.issues), getQueueLabels(workflow, role), instanceName, role);

  for (const state of candidates) {
    if (!await isIssueCreationReady(workspaceDir, projectSlug, state.creationOperationId)) continue;
    const resolution = await readWorkerDeliveryResolution(workspaceDir, projectSlug, state.issueId);

    if (resolution && !resolution.completed) continue;
    const issue = await provider.getIssue(state.issueId);

    return { issue, label: state.workflowLabel, localState: state };
  }

  return null;
}
