/**
 * transition-state.ts — Keep project-local issue runtime state in sync after heartbeat transitions.
 */

import { withIssueOrchestrationLock } from "../../state/index.js";
import { commitWorkflowTransitionLocked } from "../pipeline/transition.js";
import type { HeartbeatTransitionInput } from "./types.js";

/** Recheck the local source state under the issue lock before actions and commit.
 * @param opts - Planned heartbeat transition and policy-specific provider actions.
 */
export async function transitionHeartbeatIssue(opts: HeartbeatTransitionInput): Promise<boolean> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.project.slug, opts.issueId, async () => {
    const issue = await opts.provider.getIssue(opts.issueId);

    return commitWorkflowTransitionLocked({
      workspaceDir: opts.workspaceDir,
      project: opts.project,
      issueId: opts.issueId,
      provider: opts.provider,
      workflow: opts.workflow,
      plan: { from: opts.fromLabel, toState: opts.workflowState, toLabel: opts.workflowLabel, actions: [] },
      owner: opts.owner,
      issue,
      closedAt: opts.closedAt,
      checkLocalState: true,
      archiveTerminal: true,
      beforeCommit: opts.beforeCommit,
      routing: opts.routing,
    });
  });
}
