/**
 * Coordinates explicitly confirmed provider issue deletion with lossless local tombstoning.
 * Provider deletion and local archival are deliberately separated by audit checkpoints.
 */
import { randomUUID } from "node:crypto";

import { log as auditLog } from "../../audit.js";
import { ISSUE_ARCHIVE_REASON, ISSUE_INTEGRITY_STATUS } from "../../domain/index.js";
import {
  isProviderIssueLookupError,
  type IssueProvider,
  PROVIDER_ISSUE_LOOKUP_ERROR,
} from "../../integrations/providers/index.js";
import { readIssueArchiveStore, readIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { archiveManagedIssueLocked } from "./archive.js";

/** Structured result for dry-run, success, or recoverable partial failure. */
export type DeleteManagedIssueResult = {
  issueId: number;
  dryRun: boolean;
  deleted: boolean;
  archived: boolean;
  correlationId: string;
  plan: string[];
  recoveryPlan?: string[];
};

/** Delete one provider issue only after exact numeric confirmation and archive its local tombstone. */
export function deleteManagedIssue(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  confirmIssueId?: number;
  dryRun?: boolean;
  provider: IssueProvider;
  actor: string;
}): Promise<DeleteManagedIssueResult> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.projectSlug, opts.issueId, () => deleteManagedIssueLocked(opts));
}

/** Execute confirmed deletion while holding the issue orchestration lock. */
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

  if (state.activeWorker) throw new Error(`Issue #${opts.issueId} has an active worker and cannot be deleted.`);
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

  await auditLog(opts.workspaceDir, "issue_delete_requested", {
    projectSlug: opts.projectSlug,
    issueId: opts.issueId,
    provider: state.provider,
    actor: opts.actor,
    reason: "explicit_user_request",
    correlationId,
    dryRun,
  });

  if (dryRun) return { issueId: opts.issueId, dryRun: true, deleted: false, archived: false, correlationId, plan };

  if (issue) {
    try {
      await opts.provider.deleteIssue(opts.issueId);
      await auditLog(opts.workspaceDir, "issue_delete_provider_succeeded", {
        projectSlug: opts.projectSlug, issueId: opts.issueId, provider: state.provider,
        actor: opts.actor, reason: "explicit_user_request", correlationId,
      });
    } catch (error) {
      await auditLog(opts.workspaceDir, "issue_delete_provider_failed", {
        projectSlug: opts.projectSlug, issueId: opts.issueId, provider: state.provider,
        actor: opts.actor, reason: "provider_delete_failed", correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
}
