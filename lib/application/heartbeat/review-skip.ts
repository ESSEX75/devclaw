/**
 * review-skip.ts — Auto-merge and transition review:skip issues through the review queue.
 *
 * When local reviewPolicy is "skip", issues arrive in the review queue
 * through issues.json state. This pass auto-merges their PR and
 * transitions them to the next state (e.g. toTest), executing the
 * SKIP event's configured actions (mergePr, gitPull).
 *
 * Mirrors testSkipPass() in test-skip.ts — called by the heartbeat service.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import {
  ACTION,
  STATE_TYPE,
  WORKFLOW_EVENT,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import { PrState, type PrStatus } from "../../integrations/providers/provider.js";
import { planWorkflowEvent } from "../pipeline/plan.js";
import { getHeartbeatCandidates } from "./local-candidates.js";
import { transitionHeartbeatIssue } from "./transition-state.js";

/**
 * Scan review queue states and auto-merge + transition issues with reviewPolicy=skip.
 * Returns the number of transitions made.
 * @param opts - Project workflow and provider actions for the explicit skip policy.
 */
export async function reviewSkipPass(opts: {
  workspaceDir: string;
  projectName: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  workflow: WorkflowConfig;
  provider: IssueProvider;
  repoPath: string;
  gitPullTimeoutMs?: number;
  /** Called after a successful PR merge (for notifications). */
  onMerge?: (issueId: number, prUrl: string | null, prTitle?: string, sourceBranch?: string) => void;
  runCommand: RunCommand;
}): Promise<number> {
  const rc = opts.runCommand;
  const { workspaceDir, projectName, project, workflow, provider, repoPath, gitPullTimeoutMs = 30_000, onMerge } = opts;
  let transitions = 0;

  // Find review queue states (role=reviewer, type=queue) that have a SKIP event
  const reviewQueueStates = Object.entries(workflow.states)
    .filter(([, state]) => state.role === "reviewer" && state.type === STATE_TYPE.QUEUE);

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
      routing: { field: "reviewPolicy", value: "skip" },
    });

    for (const { issue } of candidates) {

      let mergeFailure: unknown;
      const mergeNotification: { status: PrStatus | null } = { status: null };
      let transitioned: boolean;

      try {
        transitioned = await transitionHeartbeatIssue({
          workspaceDir, project, issueId: issue.iid, provider, workflow,
          fromLabel: state.label, workflowState: targetKey,
          workflowLabel: targetState.label, owner: "heartbeat_review_skip",
          routing: { field: "reviewPolicy", value: "skip" },
          beforeCommit: async () => {
            for (const action of actions) {
              switch (action) {
                case ACTION.MERGE_PR: {
                  const status = await provider.getPrStatus(issue.iid);

                  if (status.state === PrState.MERGED) {
                    mergeNotification.status = status;
                    break;
                  }

                  if (!status.url) break;
                  try { await provider.mergePr(issue.iid); }
                  catch (error) { mergeFailure = error; throw error; }

                  mergeNotification.status = status;
                  break;
                }

                case ACTION.GIT_PULL:
                  try { await rc(["git", "pull"], { timeoutMs: gitPullTimeoutMs, cwd: repoPath }); }
                  catch { /* best effort */ }

                  break;
                case ACTION.CLOSE_ISSUE:
                  try { await provider.closeIssue(issue.iid); } catch { /* best effort */ }

                  break;
                case ACTION.REOPEN_ISSUE:
                  try { await provider.reopenIssue(issue.iid); } catch { /* best effort */ }

                  break;
              }
            }
          },
        });
      } catch (error) {
        if (mergeFailure === undefined) throw error;
        await auditLog(workspaceDir, "review_skip_merge_failed", {
          project: projectName, issueId: issue.iid, from: state.label,
          error: error instanceof Error ? error.message : String(error),
        });
        const failed = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_FAILED);

        if (failed && await transitionHeartbeatIssue({
          workspaceDir, project, issueId: issue.iid, provider, workflow,
          fromLabel: state.label, workflowState: failed.toState,
          workflowLabel: failed.toLabel, owner: "heartbeat_review_skip_merge_failure",
          routing: { field: "reviewPolicy", value: "skip" },
        })) transitions++;
        continue;
      }

      if (!transitioned) continue;
      if (mergeNotification.status) {
        onMerge?.(issue.iid, mergeNotification.status.url, mergeNotification.status.title, mergeNotification.status.sourceBranch);
      }

      await auditLog(workspaceDir, "review_skip_transition", {
        project: projectName,
        issueId: issue.iid,
        from: state.label,
        to: targetState.label,
        reason: "review:skip",
      });

      transitions++;
    }
  }

  return transitions;
}
