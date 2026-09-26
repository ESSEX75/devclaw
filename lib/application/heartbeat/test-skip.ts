/**
 * test-skip.ts — Auto-transition test:skip issues through the test queue.
 *
 * When local testPolicy is "skip" (default), issues arrive in the test queue
 * through issues.json state. This pass auto-transitions them to done,
 * executing the SKIP event's configured actions (e.g. closeIssue).
 *
 * Mirrors reviewPass() in review.ts — called by the heartbeat service.
 */
import { log as auditLog } from "../../audit.js";
import type { Project } from "../../domain/index.js";
import {
  ACTION,
  STATE_TYPE,
  WORKFLOW_EVENT,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import { planWorkflowEvent } from "../pipeline/plan.js";
import { getHeartbeatCandidates } from "./local-candidates.js";
import { transitionHeartbeatIssue } from "./transition-state.js";

/**
 * Scan test queue states and auto-transition issues with testPolicy=skip.
 * Returns the number of transitions made.
 * @param opts - Project workflow and provider for the explicit test skip policy.
 */
export async function testSkipPass(opts: {
  workspaceDir: string;
  projectName: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  workflow: WorkflowConfig;
  provider: IssueProvider;
}): Promise<number> {
  const { workspaceDir, projectName, project, workflow, provider } = opts;
  let transitions = 0;

  // Find test queue states (role=tester, type=queue) that have a SKIP event
  const testQueueStates = Object.entries(workflow.states)
    .filter(([, state]) => state.role === "tester" && state.type === STATE_TYPE.QUEUE);

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
      routing: { field: "testPolicy", value: "skip" },
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
        owner: "heartbeat_test_skip",
        routing: { field: "testPolicy", value: "skip" },
        beforeCommit: async () => {
          for (const action of actions) {
            if (action === ACTION.CLOSE_ISSUE) {
              try { await provider.closeIssue(issue.iid); } catch { /* best-effort */ }
            } else if (action === ACTION.REOPEN_ISSUE) {
              try { await provider.reopenIssue(issue.iid); } catch { /* best-effort */ }
            }
          }
        },
      });

      if (!transitioned) continue;

      await auditLog(workspaceDir, "test_skip_transition", {
        project: projectName,
        issueId: issue.iid,
        from: state.label,
        to: targetState.label,
        reason: "test:skip",
      });

      transitions++;
    }
  }

  return transitions;
}
