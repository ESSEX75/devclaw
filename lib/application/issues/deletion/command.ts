/**
 * Coordinates explicitly confirmed provider issue deletion with lossless local tombstoning.
 * Provider deletion and local archival are deliberately separated by audit checkpoints.
 */

import { randomUUID } from "node:crypto";

import { log as auditLog } from "../../../audit.js";
import { findSlotByIssue, ISSUE_ARCHIVE_REASON, ISSUE_INTEGRITY_STATUS, PIPELINE_NOTIFICATION_STATUS } from "../../../domain/index.js";
import {
  isProviderIssueLookupError,
  PROVIDER_ISSUE_LOOKUP_ERROR
} from "../../../integrations/providers/index.js";
import { readIssueArchiveStore, readIssueStateStore, readOptionalProjects, withIssueOrchestrationLock } from "../../../state/index.js";
import { archiveManagedIssueLocked } from "../archive/index.js";
import { DELETE_EVENT, DELETE_REASON } from "./const.js";
import type { DeleteManagedIssueInput, DeleteManagedIssueResult } from "./types.js";

/** Delete one provider issue only after exact numeric confirmation and archive its local tombstone.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export function deleteManagedIssue(opts: DeleteManagedIssueInput): Promise<DeleteManagedIssueResult> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.projectSlug, opts.issueId, () => deleteManagedIssueLocked(opts));
}

/** Execute confirmed deletion while holding the issue orchestration lock.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
async function deleteManagedIssueLocked(opts: Parameters<typeof deleteManagedIssue>[0]): Promise<DeleteManagedIssueResult> {
  const correlationId = randomUUID();
  const dryRun = opts.dryRun !== false;
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const state = store.issues[String(opts.issueId)];

  if (!state) {
    const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
    const tombstone = Object.values(archive.issues).find(
      (record) => record.issueId === opts.issueId && record.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED,
    );

    if (tombstone && !dryRun && opts.confirmIssueId === opts.issueId) {
      return { issueId: opts.issueId, dryRun: false, deleted: true, archived: true, correlationId, plan: [] };
    }

    throw new Error(`Issue #${opts.issueId} has no active local runtime state.`);
  }

  if (state.activeWorker || state.pendingWorkerRelease) throw new Error(`Issue #${opts.issueId} has an active worker and cannot be deleted.`);
  if (state.pipelineNotification && state.pipelineNotification.status !== PIPELINE_NOTIFICATION_STATUS.DELIVERED) {
    throw new Error(`Issue #${opts.issueId} has an unconfirmed notification and cannot be deleted.`);
  }

  const project = (await readOptionalProjects(opts.workspaceDir))?.projects[opts.projectSlug];

  if (project && Object.values(project.workers).some(worker => findSlotByIssue(worker, opts.issueId))) {
    throw new Error(`Issue #${opts.issueId} has an assigned worker slot and cannot be deleted.`);
  }

  if (state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${opts.issueId} has integrity_error and cannot be deleted until repaired.`);
  }

  if (!opts.provider.supportsIssueDeletion()) throw new Error("The configured provider adapter does not support issue deletion.");
  if (!dryRun && opts.confirmIssueId !== opts.issueId) {
    throw new Error(`confirmIssueId must exactly match issueId (${opts.issueId}).`);
  }

  let issue: Awaited<ReturnType<typeof opts.provider.getIssue>> | undefined;

  try {
    issue = await opts.provider.getIssue(opts.issueId);
  } catch (error) {
    if (dryRun || !isProviderIssueLookupError(error) || error.code !== PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) throw error;
  }

  const plan = [
    `Delete provider issue #${opts.issueId}`,
    `Archive provider-deleted tombstone for ${opts.projectSlug}#${opts.issueId}`,
    "Retain attachments until archive maintenance expires",
  ];

  if (dryRun) return { issueId: opts.issueId, dryRun: true, deleted: false, archived: false, correlationId, plan };

  await auditLog(opts.workspaceDir, DELETE_EVENT.REQUESTED, {
    projectSlug: opts.projectSlug,
    issueId: opts.issueId,
    provider: state.provider,
    actor: opts.actor,
    reason: DELETE_REASON.EXPLICIT_REQUEST,
    correlationId,
    dryRun,
  });

  if (issue) {
    try {
      await opts.provider.deleteIssue(opts.issueId);

    } catch (error) {
      await auditLog(opts.workspaceDir, DELETE_EVENT.PROVIDER_FAILED, {
        projectSlug: opts.projectSlug, issueId: opts.issueId, provider: state.provider,
        actor: opts.actor, reason: DELETE_REASON.PROVIDER_FAILED, correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await auditLog(opts.workspaceDir, DELETE_EVENT.PROVIDER_SUCCEEDED, {
      projectSlug: opts.projectSlug, issueId: opts.issueId, provider: state.provider,
      actor: opts.actor, reason: DELETE_REASON.EXPLICIT_REQUEST, correlationId,
    });
  }

  try {
    await opts.provider.getIssue(opts.issueId);

    return {
      issueId: opts.issueId,
      dryRun: false,
      deleted: false,
      archived: false,
      correlationId,
      plan,
      recoveryPlan: ["Provider still returns the issue.", "Do not modify local state.", "Retry deletion after verifying provider permissions."],
    };
  } catch (error) {
    if (!isProviderIssueLookupError(error) || error.code !== PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) throw error;
  }

  try {
    const archive = await archiveManagedIssueLocked({
      workspaceDir: opts.workspaceDir,
      projectSlug: opts.projectSlug,
      issueId: opts.issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.PROVIDER_DELETED,
      snapshot: issue ? { title: issue.title, issueUrl: issue.web_url } : undefined,
      providerDeletedAt: new Date().toISOString(),
      actor: opts.actor,
      correlationId,
    });

    if (!archive.archived) {
      return {
        issueId: opts.issueId,
        dryRun: false,
        deleted: true,
        archived: false,
        correlationId,
        plan,
        recoveryPlan: ["Provider issue was deleted.", "Retry local archive for this issue; the active snapshot remains in issues.json."],
      };
    }

    return { issueId: opts.issueId, dryRun: false, deleted: true, archived: true, correlationId, plan };
  } catch (error) {
    return {
      issueId: opts.issueId, dryRun: false, deleted: true, archived: false, correlationId, plan,
      recoveryPlan: ["Provider deletion was confirmed. Retry local archival; do not recreate the provider issue.", error instanceof Error ? error.message : String(error)]
    };
  }

}
