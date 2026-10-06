/** Applies bounded retention against exact fresh records, retaining recovery state until cleanup succeeds. */

import { log as auditLog } from "../../../audit.js";
import { type ArchivedIssueRecord, ATTACHMENT_DISPOSITION } from "../../../domain/index.js";
import { applyArchiveRetention, readIssueArchiveStore, readOptionalProjects, withIssueOrchestrationLock } from "../../../state/index.js";
import { hasProjectWorkerSlot } from "../worker-slot.js";
import { ARCHIVE_EVENT, ARCHIVE_MAINTENANCE_ACTOR, ARCHIVE_MAINTENANCE_CORRELATION_PREFIX, RETENTION_REASON } from "./const.js";
import { isArchiveRecordExpired, parseDuration, validateRetentionBudget } from "./planning.js";
import type { ArchiveMaintenanceResult, ArchivePurgeResult, MaintainIssueArchiveInput, PurgeIssueArchiveInput } from "./types.js";

/** Project and retention windows common to explicit and periodic cleanup. */
type RetentionContext = Pick<MaintainIssueArchiveInput, "workspaceDir" | "projectSlug" | "archiveRetention" | "deletedProviderRetention">;

/** Preview expired records or apply exact conditional cleanup to each selected identity.
 * @param opts - Explicit apply choice, validated windows, mutation budget, and audit attribution.
 */
export async function purgeIssueArchive(opts: PurgeIssueArchiveInput): Promise<ArchivePurgeResult> {
  validateRetentionBudget(opts.maxItems);
  validateWindows(opts);
  const now = Date.now();
  const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const selected = Object.values(archive.issues).filter(record => isArchiveRecordExpired(record, { ...opts, now })).slice(0, opts.maxItems);

  if (!opts.apply) return { dryRun: true, purge: selected.map(record => record.issueId) };
  const purge: number[] = [];

  for (const record of selected) {
    const result = await applyRetentionRecord(opts, record, true, opts.actor, opts.correlationId);

    if (result.recordRemoved) purge.push(record.issueId);
  }

  return { dryRun: false, purge };
}

/** Process each selected record once; archive expiry always includes attachment cleanup.
 * @param opts - Project retention policy and maximum records processed by this pass.
 */
export async function maintainIssueArchive(opts: MaintainIssueArchiveInput): Promise<ArchiveMaintenanceResult> {
  validateRetentionBudget(opts.maxItems);
  validateWindows(opts);
  const now = Date.now();
  const attachmentCutoff = now - parseDuration(opts.attachmentsRetention);
  const archive = await readIssueArchiveStore(opts.workspaceDir, opts.projectSlug);
  const selected = Object.values(archive.issues).filter(record => isArchiveRecordExpired(record, { ...opts, now })
    || (record.attachmentDisposition === ATTACHMENT_DISPOSITION.RETAINED && Date.parse(record.archivedAt) <= attachmentCutoff)).slice(0, opts.maxItems);
  const result: ArchiveMaintenanceResult = { attachmentsPurged: [], recordsPurged: [] };

  for (const record of selected) {
    const removeRecord = isArchiveRecordExpired(record, { ...opts, now });
    const applied = await applyRetentionRecord(opts, record, removeRecord, ARCHIVE_MAINTENANCE_ACTOR,
      `${ARCHIVE_MAINTENANCE_CORRELATION_PREFIX}${opts.projectSlug}:${record.issueId}:${now}`);

    if (applied.attachmentsPurged) result.attachmentsPurged.push(record.issueId);
    if (applied.recordRemoved) result.recordsPurged.push(record.issueId);
  }

  return result;
}

/** Recheck record identity and worker ownership under the orchestration lock before state-owned cleanup.
 * @param opts - Project storage identity and selected retention windows.
 * @param expected - Exact record observed during planning.
 * @param removeRecord - Whether record expiry requires final removal after cleanup.
 * @param actor - Operator or maintenance identity recorded in audit.
 * @param correlationId - Shared identity for intent and completion checkpoints.
 */
async function applyRetentionRecord(opts: RetentionContext, expected: ArchivedIssueRecord, removeRecord: boolean, actor: string, correlationId: string) {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.projectSlug, expected.issueId, async () => {
    const registry = await readOptionalProjects(opts.workspaceDir);
    const project = registry?.projects[opts.projectSlug];

    if (project && hasProjectWorkerSlot(project, expected.issueId)) {
      return { applied: false, attachmentsPurged: false, recordRemoved: false };
    }

    const reason = removeRecord ? RETENTION_REASON.ARCHIVE : RETENTION_REASON.ATTACHMENTS;
    const audit = { projectSlug: opts.projectSlug, issueId: expected.issueId, provider: expected.provider, actor, reason, correlationId };
    const result = await applyArchiveRetention(opts.workspaceDir, opts.projectSlug, {
      expected, removeRecord,
      beforeDelete: manifest => auditLog(opts.workspaceDir, ARCHIVE_EVENT.ATTACHMENTS_PLANNED, { ...audit, manifest }),
    });

    if (result.attachmentsPurged) await auditLog(opts.workspaceDir, ARCHIVE_EVENT.ATTACHMENTS_PURGED, audit);
    if (result.recordRemoved) await auditLog(opts.workspaceDir, ARCHIVE_EVENT.PURGED, { ...audit, issueIds: [expected.issueId] });

    return result;
  });
}

/** Validate every supplied record-retention window even when the archive is empty.
 * @param opts - Ordinary and provider-deleted windows supplied by the caller.
 */
function validateWindows(opts: RetentionContext): void {
  parseDuration(opts.archiveRetention);
  parseDuration(opts.deletedProviderRetention);
}
