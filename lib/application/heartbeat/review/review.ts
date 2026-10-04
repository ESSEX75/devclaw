/**
 * review.ts — Poll review-type states for PR status changes.
 *
 * Scans review states in the workflow and transitions issues
 * whose PR check condition (merged/approved) is met.
 * Called by the heartbeat service during its periodic sweep.
 */

import { log as auditLog } from "../../../audit.js";
import {
  ACTION,
  REVIEW_POLICY,
  REVIEW_ROUTING_FIELD,
  WORKFLOW_EVENT,
} from "../../../domain/index.js";
import { PrState } from "../../../integrations/providers/provider.js";
import { planWorkflowEvent } from "../../pipeline/plan.js";
import { getHeartbeatCandidates } from "../local-candidates.js";
import { transitionHeartbeatIssue } from "../transition-state.js";
import {
  DEFAULT_REVIEW_GIT_PULL_TIMEOUT_MS, REVIEW_AUDIT_EVENT, REVIEW_GIT_PULL_COMMAND, REVIEW_OUTCOME,
  REVIEW_TRANSITION_OWNER, REVIEW_TRANSITION_REASON,
} from "./const.js";
import { classifyReviewOutcome } from "./review-outcome.js";
import type { ReviewPassInput } from "./types.js";

/**
 * Scan review-type states and transition issues whose PR check condition is met.
 * Returns the number of transitions made.
 * @param opts - Project workflow, provider, and callbacks invoked after committed transitions.
 */
export async function reviewPass(opts: ReviewPassInput): Promise<number> {
  const rc = opts.runCommand;
  const { workspaceDir, projectName, project, workflow, provider, repoPath,
    gitPullTimeoutMs = DEFAULT_REVIEW_GIT_PULL_TIMEOUT_MS, baseBranch, onMerge, onFeedback, onPrClosed } = opts;
  let transitions = 0;

  // Find all states with a review check (e.g. toReview with check: prApproved)
  const reviewStates = Object.values(workflow.states).filter((state) => state.check != null);

  for (const state of reviewStates) {
    if (!state.on || !state.check) continue;

    const candidates = await getHeartbeatCandidates({
      workspaceDir,
      projectSlug: project.slug,
      workflowLabel: state.label,
      provider,
      routing: { field: REVIEW_ROUTING_FIELD, value: REVIEW_POLICY.HUMAN },
    });

    for (const { issue } of candidates) {

      const status = await provider.getPrStatus(issue.iid);
      const syncTransitionState = async (
        targetKey: string,
        targetLabel: string,
        closedAt?: string | null,
        beforeCommit?: () => Promise<void>,
      ): Promise<boolean> => {
        return transitionHeartbeatIssue({
          workspaceDir,
          project,
          issueId: issue.iid,
          provider,
          workflow,
          fromLabel: state.label,
          workflowState: targetKey,
          workflowLabel: targetLabel,
          closedAt,
          owner: REVIEW_TRANSITION_OWNER.REVIEW,
          beforeCommit,
          routing: { field: REVIEW_ROUTING_FIELD, value: REVIEW_POLICY.HUMAN },
        });
      };

      // Fallback: no PR found, but work may have been committed directly to base branch.
      // Check git history for commits mentioning this issue number.
      if (!status.url && status.state === PrState.CLOSED && baseBranch) {
        try {
          const isOnBranch = await provider.isCommitOnBaseBranch(issue.iid, baseBranch);

          if (isOnBranch) {
            status.state = PrState.MERGED;
            await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.GIT_FALLBACK, {
              project: projectName, issueId: issue.iid,
              reason: REVIEW_TRANSITION_REASON.COMMIT_ON_BASE_BRANCH,
              baseBranch,
            });
          }
        } catch { /* best-effort — don't block on git failure */ }
      }

      const outcome = classifyReviewOutcome(
        status,
        state.check,
        planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.CHANGES_REQUESTED) !== null,
        planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_CONFLICT) !== null,
      );

      // Changes requested or PR has comment feedback → transition to toImprove
      if (outcome.kind === REVIEW_OUTCOME.CHANGES_REQUESTED) {
        const changesTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.CHANGES_REQUESTED);

        if (changesTransition) {
          const targetKey = changesTransition.toState;
          const targetState = workflow.states[targetKey];

          if (targetState) {
            if (!await syncTransitionState(targetKey, targetState.label)) continue;
            await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.TRANSITION, {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: status.state === PrState.HAS_COMMENTS
                ? REVIEW_TRANSITION_REASON.PR_COMMENTS : REVIEW_TRANSITION_REASON.CHANGES_REQUESTED,
              prUrl: status.url,
            });
            onFeedback?.(issue.iid, REVIEW_TRANSITION_REASON.CHANGES_REQUESTED, status.url, issue.title, issue.web_url, targetState.label);
            transitions++;
            continue;
          }
        }
      }

      // Merge conflict → transition to toImprove
      if (outcome.kind === REVIEW_OUTCOME.CONFLICT) {
        const conflictTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_CONFLICT);

        if (conflictTransition) {
          const targetKey = conflictTransition.toState;
          const targetState = workflow.states[targetKey];

          if (targetState) {
            if (!await syncTransitionState(targetKey, targetState.label)) continue;
            await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.TRANSITION, {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: REVIEW_TRANSITION_REASON.MERGE_CONFLICT,
              prUrl: status.url,
            });
            onFeedback?.(issue.iid, REVIEW_TRANSITION_REASON.MERGE_CONFLICT, status.url, issue.title, issue.web_url, targetState.label);
            transitions++;
            continue;
          }
        }
      }

      // PR closed without merging → execute configured transition + actions
      // status.url non-null distinguishes "PR was explicitly closed" from "no PR exists"
      if (outcome.kind === REVIEW_OUTCOME.CLOSED_UNMERGED) {
        const closedTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.PR_CLOSED);

        if (closedTransition) {
          const targetKey = closedTransition.toState;
          const closedActions = closedTransition.actions;
          const targetState = workflow.states[targetKey];

          if (targetState) {
            if (!await syncTransitionState(
              targetKey,
              targetState.label,
              closedActions?.includes(ACTION.CLOSE_ISSUE) ? new Date().toISOString() : undefined,
              async () => {
                for (const action of closedActions ?? []) {
                  if (action === ACTION.CLOSE_ISSUE) {
                    await provider.closeIssue(issue.iid);
                  } else if (action === ACTION.REOPEN_ISSUE) {
                    await provider.reopenIssue(issue.iid);
                  }
                }
              },
            )) continue;
            await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.TRANSITION, {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: REVIEW_TRANSITION_REASON.PR_CLOSED,
              prUrl: status.url,
              actions: closedActions,
            });
            onPrClosed?.(issue.iid, status.url, issue.title, issue.web_url, targetState.label);
            transitions++;
            continue;
          }
        }
      }

      if (outcome.kind !== REVIEW_OUTCOME.APPROVED) continue;

      // Find the success transition — use the APPROVED event (matches check condition)
      const transition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.APPROVED);

      if (!transition) continue;

      const targetKey = transition.toState;
      const actions = transition.actions;
      const targetState = workflow.states[targetKey];

      if (!targetState) continue;

      let mergeFailure: unknown;
      let merged = false;
      let transitioned: boolean;

      try {
        transitioned = await syncTransitionState(targetKey, targetState.label, undefined, async () => {
          for (const action of actions) {
            switch (action) {
              case ACTION.MERGE_PR:
                if (status.state !== PrState.MERGED) {
                  try { await provider.mergePr(issue.iid); }
                  catch (error) { mergeFailure = error; throw error; }
                }

                merged = true;
                break;
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
        });
      } catch (error) {
        if (mergeFailure === undefined) throw error;
        await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.MERGE_FAILED, {
          project: projectName, issueId: issue.iid, from: state.label,
          error: error instanceof Error ? error.message : String(error),
        });
        const failed = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_FAILED);

        if (failed && await syncTransitionState(failed.toState, failed.toLabel)) {
          await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.TRANSITION, {
            project: projectName, issueId: issue.iid, from: state.label,
            to: failed.toLabel, reason: REVIEW_TRANSITION_REASON.MERGE_FAILED,
          });
          transitions++;
        }

        continue;
      }

      if (!transitioned) continue;
      if (merged) onMerge?.(issue.iid, status.url, status.title, status.sourceBranch);

      await auditLog(workspaceDir, REVIEW_AUDIT_EVENT.TRANSITION, {
        project: projectName,
        issueId: issue.iid,
        from: state.label,
        to: targetState.label,
        check: state.check,
        prState: status.state,
        prUrl: status.url,
      });

      transitions++;
    }
  }

  return transitions;
}
