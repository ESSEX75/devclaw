/**
 * local-candidates.ts — Local issue-state candidate selection for heartbeat passes.
 */

import { ISSUE_INTEGRITY_STATUS } from "../../domain/index.js";
import { isIssueCreationReady, readIssueStateStore } from "../../state/index.js";
import type { HeartbeatCandidate, HeartbeatCandidateInput } from "./types.js";

/** Select initialized local issues and fetch provider context without importing provider labels as state.
 * @param opts - Local selection, optional saved policy, and provider read capability.
 */
export async function getHeartbeatCandidates(opts: HeartbeatCandidateInput): Promise<HeartbeatCandidate[]> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const states = Object.values(store.issues)
    .filter((state) =>
      state.integrityStatus !== ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
      && state.providerMissing == null
      && state.workflowLabel === opts.workflowLabel
      && (!opts.routing || state[opts.routing.field] === opts.routing.value),
    )
    .sort((a, b) => a.issueId - b.issueId);

  const candidates: HeartbeatCandidate[] = [];

  for (const localState of states) {
    if (!await isIssueCreationReady(opts.workspaceDir, opts.projectSlug, localState.creationOperationId)) continue;
    const issue = await opts.provider.getIssue(localState.issueId);

    candidates.push({ issue, localState });
  }

  return candidates;
}
