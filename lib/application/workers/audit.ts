/** Writes worker dispatch audit records without owning dispatch decisions. */

import { log as auditLog } from "../../audit.js";
import { getActiveLabel, type IssueRuntimeState } from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";
import { WORKER_AUDIT_EVENT, WORKER_REJECTION_REASON } from "./const.js";
import type { AuditDispatchOptions, MissingWorkerAuditInput } from "./types.js";

/**
 * Record dispatch identity and model selection after the worker receives its task.
 * @param workspaceDir - Workspace whose audit log receives the events.
 * @param opts - Complete dispatch metadata persisted for diagnostics.
 */
export async function auditDispatch(workspaceDir: string, opts: AuditDispatchOptions): Promise<void> {
  await auditLog(workspaceDir, WORKER_AUDIT_EVENT.DISPATCH, {
    project: opts.project,
    issue: opts.issueId, issueTitle: opts.issueTitle,
    role: opts.role, level: opts.level,
    sessionAction: opts.sessionAction, sessionKey: opts.sessionKey,
    labelTransition: `${opts.fromLabel} → ${opts.toLabel}`,
  });
  await auditLog(workspaceDir, WORKER_AUDIT_EVENT.MODEL_SELECTION, {
    issue: opts.issueId, role: opts.role, level: opts.level, model: opts.model,
  });
}

/**
 * Format an unknown dispatch failure for audit diagnostics.
 * @param error - Failure caught from a provider, state, or gateway operation.
 */
export function dispatchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Record actionable local observations for a rejected finish request.
 * @param opts - Requested role/session and observed project state.
 */
export async function auditWorkFinishRejectedMissingActiveWorker(opts: MissingWorkerAuditInput): Promise<void> {
  let activeWorkflowLabel: string | null = null;
  let candidateIssues: Array<Pick<IssueRuntimeState, "issueId" | "workflowState" | "workflowLabel" | "activeWorker">> = [];

  try {
    activeWorkflowLabel = getActiveLabel(opts.workflow, opts.role);
    const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);

    candidateIssues = Object.values(store.issues)
      .filter((state) =>
        state.assignedRole === opts.role ||
        state.activeWorker?.role === opts.role ||
        state.workflowLabel === activeWorkflowLabel,
      )
      .map((state) => ({
        issueId: state.issueId,
        workflowState: state.workflowState,
        workflowLabel: state.workflowLabel,
        activeWorker: state.activeWorker,
      }));
  } catch {
    // Rejection audit is best-effort; never mask the original validation error.
  }

  await auditLog(opts.workspaceDir, WORKER_AUDIT_EVENT.FINISH_REJECTED, {
    project: opts.projectName,
    projectSlug: opts.projectSlug,
    issue: null,
    role: opts.role,
    result: opts.result,
    reason: WORKER_REJECTION_REASON.MISSING_ACTIVE_WORKER,
    requestedSessionKey: opts.sessionKey ?? null,
    activeWorkflowLabel,
    candidateIssues,
    roleWorker: opts.roleWorker,
  });
}
