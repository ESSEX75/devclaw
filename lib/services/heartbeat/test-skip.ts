/**
 * test-skip.ts — Auto-transition test:skip issues through the test queue.
 *
 * When local testPolicy is "skip" (default), issues arrive in the test queue
 * through issues.json state. This pass auto-transitions them to done,
 * executing the SKIP event's configured actions (e.g. closeIssue).
 *
 * Mirrors reviewPass() in review.ts — called by the heartbeat service.
 */
import type { IssueProvider } from "../../integrations/providers/provider.js";
import type { Project } from "../../projects/index.js";
import {
  Action,
  StateType,
  WorkflowEvent,
  type WorkflowConfig,
  type StateConfig,
} from "../../domain/workflow/index.js";
import { log as auditLog } from "../../audit.js";
import { getHeartbeatCandidates } from "./local-candidates.js";
import { writeHeartbeatTransitionState } from "./transition-state.js";

/**
 * Scan test queue states and auto-transition issues with testPolicy=skip.
 * Returns the number of transitions made.
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
    .filter(([, s]) => s.role === "tester" && s.type === StateType.QUEUE) as [string, StateConfig][];

  for (const [_stateKey, state] of testQueueStates) {
    const skipTransition = state.on?.[WorkflowEvent.SKIP];
    if (!skipTransition) continue;

    const targetKey = typeof skipTransition === "string" ? skipTransition : skipTransition.target;
    const actions = typeof skipTransition === "object" ? skipTransition.actions : undefined;
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

      // Execute SKIP transition actions
      if (actions) {
        for (const action of actions) {
          switch (action) {
            case Action.CLOSE_ISSUE:
              try { await provider.closeIssue(issue.iid); } catch { /* best-effort */ }
              break;
            case Action.REOPEN_ISSUE:
              try { await provider.reopenIssue(issue.iid); } catch { /* best-effort */ }
              break;
          }
        }
      }

      // Transition label
      await provider.transitionLabel(issue.iid, state.label, targetState.label);
      await writeHeartbeatTransitionState({
        workspaceDir,
        project,
        issue,
        workflow,
        workflowState: targetKey,
        workflowLabel: targetState.label,
        closedAt: actions?.includes(Action.CLOSE_ISSUE) ? new Date().toISOString() : undefined,
      });

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
