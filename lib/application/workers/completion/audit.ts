/** Records completion rejection evidence without masking validation failures. */

import { log as auditLog } from "../../../audit.js";
import { getActiveLabel, type IssueRuntimeState } from "../../../domain/index.js";
import { readIssueStateStore } from "../../../state/index.js";
import { WORKER_AUDIT_EVENT } from "../const.js";
import { WORKER_REJECTION_REASON } from "./const.js";
import type { MissingWorkerAuditInput } from "./types.js";

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
