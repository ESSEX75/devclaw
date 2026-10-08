/** Executes completion provider actions and observes merged state before retrying a merge. */

import { log as auditLog } from "../../audit.js";
import { ACTION, type CompletionRule } from "../../domain/index.js";
import { type Issue, PR_STATE, PROVIDER_ISSUE_STATE } from "../../integrations/providers/index.js";
import { PIPELINE_AUDIT, PIPELINE_GIT_PULL_COMMAND } from "./const.js";
import type { CompletionActions, CompletionInput } from "./types.js";

/** Perform configured actions; read failures preserve the source state for a later retry.
 * @param opts - Command and provider capabilities.
 * @param rule - Validated workflow actions.
 * @param gitPullMs - Configured best-effort checkout refresh timeout.
 */
export async function executeCompletionActions(opts: CompletionInput, rule: CompletionRule<string>, gitPullMs: number): Promise<CompletionActions> {
  const { workspaceDir, issueId, role, provider, repoPath, runCommand: rc } = opts;
  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;
  let mergeFailure: CompletionActions["mergeFailure"] = null;

  // Execute pre-notification actions
  for (const action of rule.actions) {
    switch (action) {
      case ACTION.GIT_PULL:
        try { await rc([...PIPELINE_GIT_PULL_COMMAND], { timeoutMs: gitPullMs, cwd: repoPath }); } catch (err) {
          auditLog(workspaceDir, PIPELINE_AUDIT.WARNING, { step: ACTION.GIT_PULL, issue: issueId, role, error: err instanceof Error ? err.message : String(err) }).catch(() => { });
        }

        break;
      case ACTION.DETECT_PR:
        if (!prUrl) {
          try {
            // Try open PR first (developer just finished — MR is still open), fall back to merged
            const prStatus = await provider.getPrStatus(issueId);

            prUrl = prStatus.url ?? await provider.getMergedMRUrl(issueId) ?? undefined;
            prTitle = prStatus.title;
            sourceBranch = prStatus.sourceBranch;
          } catch (err) {
            auditLog(workspaceDir, PIPELINE_AUDIT.WARNING, {
              step: ACTION.DETECT_PR, issue: issueId, role, error: err instanceof Error ? err.message : String(err),
            }).catch(() => {});
          }
        }

        break;
      case ACTION.MERGE_PR: {
        const observed = await provider.getPrStatus(issueId, prUrl);

        prUrl = prUrl ?? observed.url ?? undefined;
        prTitle = observed.title;
        sourceBranch = observed.sourceBranch;
        try {
          if (observed.state !== PR_STATE.MERGED) await provider.mergePr(issueId, prUrl);
          mergedPr = true;
        } catch (err) {
          const observed = await provider.getPrStatus(issueId, prUrl);

          if (observed.state === PR_STATE.MERGED) { mergedPr = true; break; }

          if (observed.mergeable !== false) throw err;
          const error = err instanceof Error ? err.message : String(err);

          await auditLog(workspaceDir, PIPELINE_AUDIT.ACTION_FAILED, {
            step: ACTION.MERGE_PR,
            issue: issueId,
            role,
            error,
            from: rule.from,
            attemptedTo: rule.to,
          });
          mergeFailure = { error };
        }

        break;
      }
    }

    if (mergeFailure) break;
  }

  return { prUrl, mergedPr, prTitle, sourceBranch, mergeFailure };
}

/** Apply close/reopen actions, skipping lifecycle states already observed at the provider.
 * @param opts - Command identity and provider capabilities.
 * @param rule - Ordered lifecycle actions from the configured completion.
 * @param issue - Provider snapshot read before the attempt.
 */
export async function applyCompletionLifecycle(opts: CompletionInput, rule: CompletionRule<string>, issue: Issue): Promise<void> {
  let closed = issue.state === PROVIDER_ISSUE_STATE.CLOSED;

  for (const action of rule.actions) {
    if (action === ACTION.CLOSE_ISSUE && !closed) {
      await opts.provider.closeIssue(opts.issueId);
      closed = true;
    } else if (action === ACTION.REOPEN_ISSUE && closed) {
      await opts.provider.reopenIssue(opts.issueId);
      closed = false;
    }
  }
}
