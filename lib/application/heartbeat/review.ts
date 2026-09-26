/**
 * review.ts — Poll review-type states for PR status changes.
 *
 * Scans review states in the workflow and transitions issues
 * whose PR check condition (merged/approved) is met.
 * Called by the heartbeat service during its periodic sweep.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import {
  ACTION,
  WORKFLOW_EVENT,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import { PrState } from "../../integrations/providers/provider.js";
import { planWorkflowEvent } from "../pipeline/plan.js";
import { classifyReviewOutcome } from "../pipeline/review-outcome.js";
import { getHeartbeatCandidates } from "./local-candidates.js";
import { transitionHeartbeatIssue } from "./transition-state.js";

/**
 * Scan review-type states and transition issues whose PR check condition is met.
 * Returns the number of transitions made.
 * @param opts - Project workflow, provider, and callbacks invoked after committed transitions.
 */
export async function reviewPass(opts: {
  workspaceDir: string;
  projectName: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  workflow: WorkflowConfig;
  provider: IssueProvider;
  repoPath: string;
  gitPullTimeoutMs?: number;
  /** Base branch used for git history fallback check (e.g. "main"). */
  baseBranch?: string;
  /** Called after a successful PR merge (for notifications). */
  onMerge?: (issueId: number, prUrl: string | null, prTitle?: string, sourceBranch?: string) => void;
  /** Called when changes are requested or conflicts detected (for notifications). */
  onFeedback?: (issueId: number, reason: "changes_requested" | "merge_conflict", prUrl: string | null, issueTitle: string, issueUrl: string) => void;
  /** Called when a PR is closed without merging (for notifications). */
  onPrClosed?: (issueId: number, prUrl: string | null, issueTitle: string, issueUrl: string) => void;
  runCommand: RunCommand;
}): Promise<number> {
  const rc = opts.runCommand;
  const { workspaceDir, projectName, project, workflow, provider, repoPath, gitPullTimeoutMs = 30_000, baseBranch, onMerge, onFeedback, onPrClosed } = opts;
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
      routing: { field: "reviewPolicy", value: "human" },
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
          owner: "heartbeat_review",
          beforeCommit,
          routing: { field: "reviewPolicy", value: "human" },
        });
      };

      // Fallback: no PR found, but work may have been committed directly to base branch.
      // Check git history for commits mentioning this issue number.
      if (!status.url && status.state === PrState.CLOSED && baseBranch) {
        try {
          const isOnBranch = await provider.isCommitOnBaseBranch(issue.iid, baseBranch);

          if (isOnBranch) {
            status.state = PrState.MERGED;
            await auditLog(workspaceDir, "review_git_fallback", {
              project: projectName, issueId: issue.iid,
              reason: "commit_on_base_branch",
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
      if (outcome.kind === "changes_requested") {
        const changesTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.CHANGES_REQUESTED);

        if (changesTransition) {
          const targetKey = changesTransition.toState;
          const targetState = workflow.states[targetKey];

          if (targetState) {
            if (!await syncTransitionState(targetKey, targetState.label)) continue;
            await auditLog(workspaceDir, "review_transition", {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: status.state === PrState.HAS_COMMENTS ? "pr_comments" : "changes_requested",
              prUrl: status.url,
            });
            onFeedback?.(issue.iid, "changes_requested", status.url, issue.title, issue.web_url);
            // React to each review comment with 🤖 to acknowledge processing (best-effort)
            reactToFeedbackComments(provider, issue.iid).catch(() => { });
            transitions++;
            continue;
          }
        }
      }

      // Merge conflict → transition to toImprove
      if (outcome.kind === "conflict") {
        const conflictTransition = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_CONFLICT);

        if (conflictTransition) {
          const targetKey = conflictTransition.toState;
          const targetState = workflow.states[targetKey];

          if (targetState) {
            if (!await syncTransitionState(targetKey, targetState.label)) continue;
            await auditLog(workspaceDir, "review_transition", {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: "merge_conflict",
              prUrl: status.url,
            });
            onFeedback?.(issue.iid, "merge_conflict", status.url, issue.title, issue.web_url);
            transitions++;
            continue;
          }
        }
      }

      // PR closed without merging → execute configured transition + actions
      // status.url non-null distinguishes "PR was explicitly closed" from "no PR exists"
      if (outcome.kind === "closed_unmerged") {
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
                    try { await provider.closeIssue(issue.iid); } catch { /* best-effort */ }
                  } else if (action === ACTION.REOPEN_ISSUE) {
                    try { await provider.reopenIssue(issue.iid); } catch { /* best-effort */ }
                  }
                }
              },
            )) continue;
            await auditLog(workspaceDir, "review_transition", {
              project: projectName, issueId: issue.iid,
              from: state.label, to: targetState.label,
              reason: "pr_closed",
              prUrl: status.url,
              actions: closedActions,
            });
            onPrClosed?.(issue.iid, status.url, issue.title, issue.web_url);
            transitions++;
            continue;
          }
        }
      }

      if (outcome.kind !== "approved") continue;

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
                try { await rc(["git", "pull"], { timeoutMs: gitPullTimeoutMs, cwd: repoPath }); }
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
        await auditLog(workspaceDir, "review_merge_failed", {
          project: projectName, issueId: issue.iid, from: state.label,
          error: error instanceof Error ? error.message : String(error),
        });
        const failed = planWorkflowEvent(workflow, state.label, WORKFLOW_EVENT.MERGE_FAILED);

        if (failed && await syncTransitionState(failed.toState, failed.toLabel)) {
          await auditLog(workspaceDir, "review_transition", {
            project: projectName, issueId: issue.iid, from: state.label,
            to: failed.toLabel, reason: "merge_failed",
          });
          transitions++;
        }

        continue;
      }

      if (!transitioned) continue;
      if (merged) onMerge?.(issue.iid, status.url, status.title, status.sourceBranch);

      await auditLog(workspaceDir, "review_transition", {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reaction emoji used to acknowledge PR feedback has been noticed. */
const FEEDBACK_REACTION_EMOJI = "eyes";

/**
 * Add a 🤖 reaction to all PR review comments on the issue's PR.
 * Best-effort: errors are swallowed by the caller (.catch(() => {})).
 */
async function reactToFeedbackComments(
  provider: IssueProvider,
  issueId: number,
): Promise<void> {
  const comments = await provider.getPrReviewComments(issueId);

  for (const comment of comments) {
    // Reviews (APPROVED, CHANGES_REQUESTED, COMMENTED) use a different reaction API
    // than issue/inline comments. Route accordingly.
    if (comment.state === "APPROVED" || comment.state === "CHANGES_REQUESTED" || comment.state === "COMMENTED") {
      await provider.reactToPrReview(issueId, comment.id, FEEDBACK_REACTION_EMOJI);
    } else {
      await provider.reactToPrComment(issueId, comment.id, FEEDBACK_REACTION_EMOJI);
    }
  }
}
