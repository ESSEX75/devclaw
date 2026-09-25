/** Writes worker dispatch audit records without owning dispatch decisions. */
import { log as auditLog } from "../../audit.js";
import type { AuditDispatchOptions } from "./types.js";

/**
 * Record dispatch identity and model selection after the worker receives its task.
 * @param workspaceDir - Workspace whose audit log receives the events.
 * @param opts - Complete dispatch metadata persisted for diagnostics.
 */
export async function auditDispatch(workspaceDir: string, opts: AuditDispatchOptions): Promise<void> {
  await auditLog(workspaceDir, "dispatch", {
    project: opts.project,
    issue: opts.issueId, issueTitle: opts.issueTitle,
    role: opts.role, level: opts.level,
    sessionAction: opts.sessionAction, sessionKey: opts.sessionKey,
    labelTransition: `${opts.fromLabel} → ${opts.toLabel}`,
  });
  await auditLog(workspaceDir, "model_selection", {
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
