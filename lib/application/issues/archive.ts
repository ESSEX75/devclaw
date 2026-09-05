/**
 * Owns managed-issue archival, recovery, and archive retention decisions.
 * All callers share these operations so heartbeat, CLI, and tools cannot diverge.
 */
import { createHash } from "node:crypto";

import { log as auditLog } from "../../audit.js";
import {
  type ArchivedIssueRecord,
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  type IssueArchiveReason,
  type IssueRuntimeState,
  STATE_TYPE,
  type WorkflowConfig,
} from "../../domain/index.js";
import {
  archiveIssueState,
  readIssueArchiveStore,
  readIssueStateStore,
  updateIssueArchiveStore,
} from "../../state/issues/index.js";
import { listAttachments, purgeIssueAttachments } from "../tasks/index.js";

/** Optional provider snapshot enriching an archive record without making provider data authoritative. */
export type ArchiveIssueSnapshot = {
  title?: string;
  issueUrl?: string;
};

/** Result of one archive attempt. */
export type ArchiveIssueResult = {
  issueId: number;
  archived: boolean;
  reason?: string;
  record?: ArchivedIssueRecord;
};

/** Archive one inactive, healthy issue through the lossless archive-first protocol. */
export async function archiveManagedIssue(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  archiveReason: IssueArchiveReason;
  snapshot?: ArchiveIssueSnapshot;
  providerDeletedAt?: string;
  actor: string;
  correlationId: string;
}): Promise<ArchiveIssueResult> {
  const active = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const state = active.issues[String(opts.issueId)];

  if (!state) {
    const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
    const record = Object.values(archive.issues).find((candidate) => candidate.issueId === opts.issueId);

    return { issueId: opts.issueId, archived: record !== undefined, reason: record ? "already_archived" : "not_found", record };
  }

  if (state.activeWorker) return { issueId: opts.issueId, archived: false, reason: "active_worker" };
  if (state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    return { issueId: opts.issueId, archived: false, reason: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR };
  }

  const failedState = state.workflowState.toLowerCase() === "failed" || state.workflowLabel.toLowerCase() === "failed";

  if (
    opts.archiveReason === ISSUE_ARCHIVE_REASON.TERMINAL
    && failedState
    && (state.retryAt || (state.retriesRemaining ?? 0) > 0)
  ) {
    return { issueId: opts.issueId, archived: false, reason: "retry_pending" };
  }

  const archivedAt = new Date().toISOString();
  const record = await archiveIssueState(opts.workspaceDir, opts.projectSlug, opts.issueId, (current) => ({
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
    branchContract: current.branchContract,
    attachmentDisposition: ATTACHMENT_DISPOSITION.RETAINED,
    sourceSnapshotHash: hashIssueState(current),
  }));

  if (!record) return { issueId: opts.issueId, archived: false, reason: "not_found" };
  await auditLog(opts.workspaceDir, opts.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED
    ? "issue_provider_deleted_archived"
    : "issue_archived", {
    projectSlug: opts.projectSlug,
    issueId: opts.issueId,
    provider: record.provider,
    actor: opts.actor,
    reason: opts.archiveReason,
    correlationId: opts.correlationId,
  });

  return { issueId: opts.issueId, archived: true, record };
}

/** Recover terminal states left active by an interrupted terminal transition. */
export async function recoverTerminalIssueArchives(opts: {
  workspaceDir: string;
  projectSlug: string;
  workflow: WorkflowConfig;
  maxItems: number;
  actor?: string;
}): Promise<{ archived: number[]; skipped: Array<{ issueId: number; reason: string }> }> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const terminalKeys = new Set(Object.entries(opts.workflow.states)
    .filter(([, state]) => state.type === STATE_TYPE.TERMINAL)
    .map(([key]) => key));
  const archived: number[] = [];
  const skipped: Array<{ issueId: number; reason: string }> = [];

  for (const state of Object.values(store.issues)) {
    if (archived.length >= opts.maxItems) break;
    if (!terminalKeys.has(state.workflowState)) continue;
    const failedState = state.workflowState.toLowerCase() === "failed" || state.workflowLabel.toLowerCase() === "failed";

    if (failedState && (state.retryAt || (state.retriesRemaining ?? 0) > 0)) {
      skipped.push({ issueId: state.issueId, reason: "retry_pending" });
      continue;
    }

    const result = await archiveManagedIssue({
      workspaceDir: opts.workspaceDir,
      projectSlug: opts.projectSlug,
      issueId: state.issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
      actor: opts.actor ?? "heartbeat_archive_recovery",
      correlationId: `archive:${opts.projectSlug}:${state.issueId}`,
    });

    if (result.archived) archived.push(state.issueId);
    else skipped.push({ issueId: state.issueId, reason: result.reason ?? "unknown" });
  }

  return { archived, skipped };
}

/** Summarize active, archived, and purge-eligible issue counts without mutation. */
export async function getIssueArchiveStatus(opts: {
  workspaceDir: string;
  projectSlug: string;
  archiveRetention: string;
  deletedProviderRetention: string;
  workflow?: WorkflowConfig;
}): Promise<{
  active: number;
  terminalWaitingArchive: number;
  archived: number;
  providerDeleted: number;
  purgeEligible: number;
  attachmentsRetainedBytes: number;
}> {
  const active = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const now = Date.now();

  const terminalKeys = new Set(Object.entries(opts.workflow?.states ?? {})
    .filter(([, state]) => state.type === STATE_TYPE.TERMINAL)
    .map(([key]) => key));
  let attachmentsRetainedBytes = 0;

  for (const record of Object.values(archive.issues)) {
    if (record.attachmentDisposition !== ATTACHMENT_DISPOSITION.RETAINED) continue;
    const attachments = await listAttachments(opts.workspaceDir, opts.projectSlug, record.issueId);

    attachmentsRetainedBytes += attachments.reduce((total, attachment) => total + attachment.size, 0);
  }

  return {
    active: Object.keys(active.issues).length,
    terminalWaitingArchive: Object.values(active.issues).filter((state) => terminalKeys.has(state.workflowState)).length,
    archived: Object.keys(archive.issues).length,
    providerDeleted: Object.values(archive.issues).filter((record) => record.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED).length,
    purgeEligible: Object.values(archive.issues).filter((record) => isArchiveRecordExpired(record, {
      archiveRetention: opts.archiveRetention,
      deletedProviderRetention: opts.deletedProviderRetention,
      now,
    })).length,
    attachmentsRetainedBytes,
  };
}

/** Purge expired archive records only after an explicit apply request. */
export async function purgeIssueArchive(opts: {
  workspaceDir: string;
  projectSlug: string;
  archiveRetention: string;
  deletedProviderRetention: string;
  maxItems: number;
  apply: boolean;
  actor: string;
  correlationId: string;
}): Promise<{ dryRun: boolean; purge: number[] }> {
  const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const now = Date.now();
  const purge = Object.values(archive.issues)
    .filter((record) => isArchiveRecordExpired(record, {
      archiveRetention: opts.archiveRetention,
      deletedProviderRetention: opts.deletedProviderRetention,
      now,
    }))
    .slice(0, opts.maxItems)
    .map((record) => record.issueId);

  if (opts.apply && purge.length > 0) {
    const selected = new Set(purge);

    for (const record of Object.values(archive.issues).filter((candidate) => selected.has(candidate.issueId))) {
      const manifest = await purgeIssueAttachments(opts.workspaceDir, opts.projectSlug, record.issueId);

      await auditLog(opts.workspaceDir, "issue_attachments_purged", {
        projectSlug: opts.projectSlug,
        issueId: record.issueId,
        provider: record.provider,
        actor: opts.actor,
        reason: "archive_retention",
        correlationId: opts.correlationId,
        manifest,
      });
    }

    await updateIssueArchiveStore(opts.workspaceDir, opts.projectSlug, (current) => {
      for (const [key, record] of Object.entries(current.issues)) {
        if (selected.has(record.issueId)) delete current.issues[key];
      }
    });
    await auditLog(opts.workspaceDir, "issue_archive_purged", {
      projectSlug: opts.projectSlug,
      issueIds: purge,
      actor: opts.actor,
      reason: "archive_retention",
      correlationId: opts.correlationId,
    });
  }

  return { dryRun: !opts.apply, purge };
}

/** Apply bounded attachment and archive retention during heartbeat maintenance. */
export async function maintainIssueArchive(opts: {
  workspaceDir: string;
  projectSlug: string;
  archiveRetention: string;
  deletedProviderRetention: string;
  attachmentsRetention: string;
  maxItems: number;
}): Promise<{ attachmentsPurged: number[]; recordsPurged: number[] }> {
  const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const attachmentCutoff = Date.now() - parseDuration(opts.attachmentsRetention);
  const attachmentsPurged: number[] = [];

  for (const record of Object.values(archive.issues)) {
    if (attachmentsPurged.length >= opts.maxItems) break;
    if (record.attachmentDisposition !== ATTACHMENT_DISPOSITION.RETAINED) continue;
    if (Date.parse(record.archivedAt) > attachmentCutoff) continue;
    const manifest = await purgeIssueAttachments(opts.workspaceDir, opts.projectSlug, record.issueId);

    record.attachmentDisposition = manifest.length > 0 ? ATTACHMENT_DISPOSITION.PURGED : ATTACHMENT_DISPOSITION.NONE;
    attachmentsPurged.push(record.issueId);
    await auditLog(opts.workspaceDir, "issue_attachments_purged", {
      projectSlug: opts.projectSlug, issueId: record.issueId, provider: record.provider,
      actor: "heartbeat_archive_maintenance", reason: "attachments_retention",
      correlationId: `attachments:${opts.projectSlug}:${record.issueId}`, manifest,
    });
  }

  if (attachmentsPurged.length > 0) await updateIssueArchiveStore(opts.workspaceDir, opts.projectSlug, (current) => {
    for (const [key, record] of Object.entries(archive.issues)) current.issues[key] = record;
  });

  const refreshed = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const now = Date.now();
  const eligible = Object.values(refreshed.issues)
    .filter((record) => isArchiveRecordExpired(record, {
      archiveRetention: opts.archiveRetention,
      deletedProviderRetention: opts.deletedProviderRetention,
      now,
    }))
    .slice(0, Math.max(0, opts.maxItems - attachmentsPurged.length));
  const recordsPurged = eligible.map((record) => record.issueId);

  if (recordsPurged.length > 0) {
    const keys = new Set(eligible.map((record) => `${record.provider}:${record.projectSlug}:${record.issueId}`));

    await updateIssueArchiveStore(opts.workspaceDir, opts.projectSlug, (current) => {
      for (const key of keys) delete current.issues[key];
    });
    await auditLog(opts.workspaceDir, "issue_archive_purged", {
      projectSlug: opts.projectSlug, issueIds: recordsPurged,
      actor: "heartbeat_archive_maintenance", reason: "archive_retention",
      correlationId: `maintenance:${opts.projectSlug}:${Date.now()}`,
    });
  }

  return { attachmentsPurged, recordsPurged };
}

/** Parse a strict non-negative duration into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);

  if (!match) throw new Error(`Invalid duration "${value}".`);
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const multiplier = multipliers[match[2]];

  if (multiplier === undefined) throw new Error(`Unsupported duration unit in "${value}".`);

  return amount * multiplier;
}

/** Create an archive record builder for callers that already hold issue state. */
export function buildArchivedIssueRecord(state: IssueRuntimeState, reason: IssueArchiveReason, archivedAt: string): ArchivedIssueRecord {
  return {
    projectSlug: state.projectSlug,
    issueId: state.issueId,
    provider: state.provider,
    finalWorkflowState: state.workflowState,
    finalWorkflowLabel: state.workflowLabel,
    archiveReason: reason,
    closedAt: state.closedAt,
    archivedAt,
    lastIntegrityStatus: state.integrityStatus,
    branchContract: state.branchContract,
    attachmentDisposition: ATTACHMENT_DISPOSITION.RETAINED,
    sourceSnapshotHash: hashIssueState(state),
  };
}

function hashIssueState(state: IssueRuntimeState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function isArchiveRecordExpired(
  record: ArchivedIssueRecord,
  opts: { archiveRetention: string; deletedProviderRetention: string; now: number },
): boolean {
  const retention = record.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED
    ? opts.deletedProviderRetention
    : opts.archiveRetention;

  return Date.parse(record.archivedAt) <= opts.now - parseDuration(retention);
}
