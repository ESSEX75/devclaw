/** Recovers terminal issues left active by interrupted completion and archive writes. */
import {
  ISSUE_ARCHIVE_REASON,
  STATE_TYPE
} from "../../../domain/index.js";
import {
  readIssueStateStore
} from "../../../state/index.js";
import { archiveManagedIssue } from "./command.js";
import { ARCHIVE_RECOVERY_ACTOR } from "./const.js";
import { validateRetentionBudget } from "./planning.js";
import type { ArchiveRecoveryInput, ArchiveRecoveryResult } from "./types.js";

/** Recover terminal states left active by an interrupted terminal transition.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export async function recoverTerminalIssueArchives(opts: ArchiveRecoveryInput): Promise<ArchiveRecoveryResult> {
  validateRetentionBudget(opts.maxItems);
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const terminalKeys = new Set(Object.entries(opts.workflow.states)
    .filter(([, state]) => state.type === STATE_TYPE.TERMINAL)
    .map(([key]) => key));
  const archived: number[] = [];
  const skipped: ArchiveRecoveryResult["skipped"] = [];

  for (const state of Object.values(store.issues).filter(candidate => terminalKeys.has(candidate.workflowState)).slice(0, opts.maxItems)) {
    const result = await archiveManagedIssue({
      workspaceDir: opts.workspaceDir,
      projectSlug: opts.projectSlug,
      issueId: state.issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
      workflow: opts.workflow,
      actor: opts.actor ?? ARCHIVE_RECOVERY_ACTOR,
      correlationId: `archive:${opts.projectSlug}:${state.issueId}`,
    });

    if (result.archived) archived.push(state.issueId);
    else skipped.push({ issueId: state.issueId, reason: result.reason ?? "unknown" });
  }

  return { archived, skipped };
}
