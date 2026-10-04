/**
 * test-skip.ts — Auto-transition test:skip issues through the test queue.
 *
 * When local testPolicy is "skip" (default), issues arrive in the test queue
 * through issues.json state. This pass auto-transitions them to done,
 * executing the SKIP event's configured actions (e.g. closeIssue).
 */

import { log as auditLog } from "../../../audit.js";
import {
  ACTION,
  DEFAULT_ROLES,
  ROUTING_LABELS,
  STATE_TYPE,
  TEST_POLICY,
  TEST_ROUTING_FIELD,
  WORKFLOW_EVENT,
} from "../../../domain/index.js";
import { planWorkflowEvent } from "../../pipeline/plan.js";
import { getHeartbeatCandidates } from "../local-candidates.js";
import { transitionHeartbeatIssue } from "../transition-state.js";
import { TEST_SKIP_AUDIT_EVENT, TEST_SKIP_TRANSITION_OWNER } from "./const.js";
import type { TestSkipPassInput } from "./types.js";

/**
 * Scan test queue states and auto-transition issues with testPolicy=skip.
 * Returns the number of transitions made.
 * @param opts - Project workflow and provider for the explicit test skip policy.
 */
export async function testSkipPass(opts: TestSkipPassInput): Promise<number> {
  const { workspaceDir, projectName, project, workflow, provider } = opts;
  let transitions = 0;

  //TODO: The behavior of the tester, reviewer, etc. is hard-coded.
  // Find test queue states (role=tester, type=queue) that have a SKIP event
  const testQueueStates = Object.entries(workflow.states)
    .filter(([, state]) => state.role === DEFAULT_ROLES.TESTER && state.type === STATE_TYPE.QUEUE);

  for (const [, state] of testQueueStates) {
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
      routing: { field: TEST_ROUTING_FIELD, value: TEST_POLICY.SKIP },
    });

    for (const { issue } of candidates) {

      const transitioned = await transitionHeartbeatIssue({
        workspaceDir,
        project,
        issueId: issue.iid,
        provider,
        workflow,
        fromLabel: state.label,
        workflowState: targetKey,
        workflowLabel: targetState.label,
        closedAt: actions?.includes(ACTION.CLOSE_ISSUE) ? new Date().toISOString() : undefined,
        owner: TEST_SKIP_TRANSITION_OWNER,
        routing: { field: TEST_ROUTING_FIELD, value: TEST_POLICY.SKIP },
        beforeCommit: async () => {
          for (const action of actions) {
            if (action === ACTION.CLOSE_ISSUE) {
              await provider.closeIssue(issue.iid);
            } else if (action === ACTION.REOPEN_ISSUE) {
              await provider.reopenIssue(issue.iid);
            }
          }
        },
      });

      if (!transitioned) continue;

      await auditLog(workspaceDir, TEST_SKIP_AUDIT_EVENT, {
        project: projectName,
        issueId: issue.iid,
        from: state.label,
        to: targetState.label,
        reason: ROUTING_LABELS.TEST_SKIP,
      });

      transitions++;
    }
  }

  return transitions;
}
