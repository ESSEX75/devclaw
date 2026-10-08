/**
 * review-skip.ts — Auto-merge and transition review:skip issues through the review queue.
 *
 * When local reviewPolicy is "skip", issues arrive in the review queue
 * through issues.json state. This pass auto-merges their PR and
 * transitions them to the next state (e.g. toTest), executing the
 * SKIP event's configured actions (mergePr, gitPull).
 */

import { log as auditLog } from "../../../audit.js";
import {
  ACTION,
  DEFAULT_ROLES,
  REVIEW_POLICY,
  REVIEW_ROUTING_FIELD,
  ROUTING_LABELS,
  STATE_TYPE,
  WORKFLOW_EVENT,
} from "../../../domain/index.js";
import { PR_STATE, type PrStatus } from "../../../integrations/index.js";
import { planWorkflowEvent } from "../../pipeline/plan.js";
import { getHeartbeatCandidates } from "../local-candidates.js";
import { transitionHeartbeatIssue } from "../transition-state.js";
import {
  DEFAULT_REVIEW_GIT_PULL_TIMEOUT_MS, REVIEW_AUDIT_EVENT, REVIEW_GIT_PULL_COMMAND,
  REVIEW_TRANSITION_OWNER,
} from "./const.js";
import type { ReviewSkipPassInput } from "./types.js";

/** Carries the observed PR status out of the locked transition callback. */
type MergeNotification = {
  /** Status to report after the local transition commits. */
  status: PrStatus | null;
};

/**
 * Scan review queue states and auto-merge + transition issues with reviewPolicy=skip.
 * Returns the number of transitions made.
 * @param opts - Project workflow and provider actions for the explicit skip policy.
 */
export async function reviewSkipPass(opts: ReviewSkipPassInput): Promise<number> {
  const rc = opts.runCommand;
  const { workspaceDir, projectName, project, workflow, provider, repoPath,
    gitPullTimeoutMs = DEFAULT_REVIEW_GIT_PULL_TIMEOUT_MS, onMerge } = opts;
  let transitions = 0;

  //TODO: The behavior of the tester, reviewer, etc. is hard-coded.
  // Find review queue states (role=reviewer, type=queue) that have a SKIP event
  const reviewQueueStates = Object.entries(workflow.states)
    .filter(([, state]) => state.role === DEFAULT_ROLES.REVIEWER && state.type === STATE_TYPE.QUEUE);

  for (const [, state] of reviewQueueStates) {
    const skipTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.SKIP);

    if (!skipTransition) continue;

    const targetKey = skipTransition.toState;
    const actions = skipTransition.actions;
    const targetState = workflow.states[targetKey];

    if (!targetState) continue;

    const candidates = await getHeartbeatCandidates({
      workspaceDir,
      projectSlug: project.slug,
      workflowLabel: state.label,
      provider,
      routing: { field: REVIEW_ROUTING_FIELD, value: REVIEW_POLICY.SKIP },
    });

    for (const { issue } of candidates) {

      let mergeFailure: unknown;
      const mergeNotification: MergeNotification = { status: null };
      let transitioned: boolean;

      try {
        transitioned = await transitionHeartbeatIssue({
          workspaceDir, project, issueId: issue.iid, provider, workflow,
          fromLabel: state.label, workflowState: targetKey,
          workflowLabel: targetState.label, owner: REVIEW_TRANSITION_OWNER.REVIEW_SKIP,
          routing: { field: REVIEW_ROUTING_FIELD, value: REVIEW_POLICY.SKIP },
          beforeCommit: async () => {
            for (const action of actions) {
              switch (action) {
                case ACTION.MERGE_PR: {
                  const status = await provider.getPrStatus(issue.iid);

                  if (status.state === PR_STATE.MERGED) {
                    mergeNotification.status = status;
                    break;
                  }

                  if (!status.url) break;
                  try { await provider.mergePr(issue.iid, status.url); }
                  catch (error) { mergeFailure = error; throw error; }

                  mergeNotification.status = status;
                  break;
                }

                case ACTION.GIT_PULL:
                  try { await rc([...REVIEW_GIT_PULL_COMMAND], { timeoutMs: gitPullTimeoutMs, cwd: repoPath }); }
                  catch { /* best effort */ }

                  break;
                case ACTION.CLOSE_ISSUE:
                  await provider.closeIssue(issue.iid);

                  break;
                case ACTION.REOPEN_ISSUE:
                  await provider.reopenIssue(issue.iid);

                  break;
              }
            }
          },
        });
      } catch (error) {
        if (mergeFailure === undefined) throw error;
        await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.SKIP_MERGE_FAILED, {
          project: projectName, issueId: issue.iid, from: state.label,
          error: error instanceof Error ? error.message : String(error),
        });
        const failed = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_FAILED);

        if (failed && await transitionHeartbeatIssue({
          workspaceDir, project, issueId: issue.iid, provider, workflow,
          fromLabel: state.label, workflowState: failed.toState,
          workflowLabel: failed.toLabel, owner: REVIEW_TRANSITION_OWNER.REVIEW_SKIP_MERGE_FAILURE,
          routing: { field: REVIEW_ROUTING_FIELD, value: REVIEW_POLICY.SKIP },
        })) transitions++;
        continue;
      }

      if (!transitioned) continue;
      if (mergeNotification.status) {
        onMerge?.(issue.iid, mergeNotification.status.url, mergeNotification.status.title, mergeNotification.status.sourceBranch);
      }

      await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.SKIP_TRANSITION, {
        project: projectName,
        issueId: issue.iid,
        from: state.label,
        to: targetState.label,
        reason: ROUTING_LABELS.REVIEW_SKIP,
      });

      transitions++;
    }
  }

  return transitions;
}
