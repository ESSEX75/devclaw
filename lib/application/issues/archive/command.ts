/** Archives a fresh eligible issue under its orchestration lock and the archive-first state transaction. */

import { log as auditLog } from "../../../audit.js";
import {
  type ArchivedIssueRecord,
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  type IssueArchiveReason,
  type IssueRuntimeState,
  PIPELINE_NOTIFICATION_STATUS,
  STATE_TYPE,
  type WorkflowConfig,
} from "../../../domain/index.js";
import {
  archiveIssueState,
  readIssueArchiveStore,
  readIssueStateStore,
  readWorkerDeliveryResolution,
  withIssueOrchestrationLock
} from "../../../state/index.js";
import { loadConfig, readOptionalProjects } from "../../../state/index.js";
import { hasProjectWorkerSlot } from "../worker-slot.js";
import { ARCHIVE_BLOCK_REASON, ARCHIVE_EVENT } from "./const.js";
import { hashIssueState } from "./identity.js";
import type { ArchiveIssueInput, ArchiveIssueResult } from "./types.js";

/** Archive one inactive, healthy issue through the lossless archive-first protocol.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export function archiveManagedIssue(opts: ArchiveIssueInput): Promise<ArchiveIssueResult> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.projectSlug, opts.issueId, () => archiveManagedIssueLocked(opts));
}

/** Archive while the caller already holds this issue's orchestration lock.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export async function archiveManagedIssueLocked(opts: ArchiveIssueInput): Promise<ArchiveIssueResult> {
  const active = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const state = active.issues[String(opts.issueId)];

  if (!state) {
    const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
    const record = Object.values(archive.issues).find((candidate) => candidate.issueId === opts.issueId);

    return { issueId: opts.issueId, archived: record !== undefined, reason: record ? ARCHIVE_BLOCK_REASON.ALREADY_ARCHIVED : ARCHIVE_BLOCK_REASON.NOT_FOUND, record };
  }

  const resolution = await readWorkerDeliveryResolution(opts.workspaceDir, opts.projectSlug, opts.issueId);

  if (resolution && !resolution.completed) return { issueId: opts.issueId, archived: false, reason: ARCHIVE_BLOCK_REASON.DELIVERY_RESOLUTION_PENDING };

  const workflow = opts.workflow ?? (await loadConfig(opts.workspaceDir, opts.projectSlug)).workflow;
  const registry = await readOptionalProjects(opts.workspaceDir);
  const project = registry?.projects[opts.projectSlug];

  if (project && hasProjectWorkerSlot(project, opts.issueId)) {
    return { issueId: opts.issueId, archived: false, reason: ARCHIVE_BLOCK_REASON.WORKER_SLOT };
  }

  const blocked = archiveBlockReason(state, opts.archiveReason, workflow);

  if (blocked) return { issueId: opts.issueId, archived: false, reason: blocked };

  const archivedAt = new Date().toISOString();
  let record: ArchivedIssueRecord | null;

  try {
    record = await archiveIssueState(opts.workspaceDir, opts.projectSlug, opts.issueId, (current) => {
      const reason = archiveBlockReason(current, opts.archiveReason, workflow);

      if (reason) throw new ArchiveBlockedError(reason);

      return {
        projectSlug: current.projectSlug,
        issueId: current.issueId,
        provider: current.provider,
        ...opts.snapshot,
        finalWorkflowState: current.workflowState,
        finalWorkflowLabel: current.workflowLabel,
        archiveReason: opts.archiveReason,
        closedAt: current.closedAt,
        providerDeletedAt: opts.providerDeletedAt,
        archivedAt,
        lastIntegrityStatus: current.integrityStatus,
        attachmentDisposition: ATTACHMENT_DISPOSITION.RETAINED,
        sourceSnapshotHash: hashIssueState(current),
      };
    });
  } catch (error) {
    if (error instanceof ArchiveBlockedError) return { issueId: opts.issueId, archived: false, reason: error.reason };
    throw error;
  }

  if (!record) return { issueId: opts.issueId, archived: false, reason: ARCHIVE_BLOCK_REASON.NOT_FOUND };
  await auditLog(opts.workspaceDir, opts.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED
    ? ARCHIVE_EVENT.PROVIDER_DELETED
    : ARCHIVE_EVENT.ARCHIVED, {
    projectSlug: opts.projectSlug,
    issueId: opts.issueId,
    provider: record.provider,
    actor: opts.actor,
    reason: opts.archiveReason,
    correlationId: opts.correlationId,
  });

  return { issueId: opts.issueId, archived: true, record };
}

/** Explain why a fresh issue snapshot cannot leave active state.
 * @param state - Fresh authoritative runtime record used by this operation.
 * @param reason - Domain reason requested for this archival.
 * @param workflow - Resolved project workflow including custom terminal states.
 */
function archiveBlockReason(state: IssueRuntimeState, reason: IssueArchiveReason, workflow: WorkflowConfig): string | null {
  const configuredState = workflow.states[state.workflowState];

  if (reason === ISSUE_ARCHIVE_REASON.TERMINAL
    && (configuredState?.type !== STATE_TYPE.TERMINAL || configuredState.label !== state.workflowLabel)) {
    return ARCHIVE_BLOCK_REASON.NOT_TERMINAL;
  }

  if (state.activeWorker || state.pendingWorkerRelease) return ARCHIVE_BLOCK_REASON.ACTIVE_WORKER;
  if (state.pipelineNotification && state.pipelineNotification.status !== PIPELINE_NOTIFICATION_STATUS.DELIVERED) return ARCHIVE_BLOCK_REASON.NOTIFICATION_PENDING;
  if (state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) return ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR;

  return null;
}

/** Carries a fresh-state archive rejection out of the atomic store transaction. */
class ArchiveBlockedError extends Error {
  /** Preserve the classified failure and its operator guidance.
   * @param reason - Stable eligibility refusal carried out of the locked archive transaction.
   */
  constructor(readonly reason: string) {
    super(reason);
  }
}
