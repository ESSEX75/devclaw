/** Reads issue archive counts and retention eligibility without mutation. */
import {
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  STATE_TYPE
} from "../../../domain/index.js";
import {
  listAttachments,
  readIssueArchiveStore,
  readIssueStateStore
} from "../../../state/index.js";
import { isArchiveRecordExpired } from "./planning.js";
import type { ArchiveStatusInput, ArchiveStatusResult } from "./types.js";

/** Summarize active, archived, and purge-eligible issue counts without mutation.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export async function getIssueArchiveStatus(opts: ArchiveStatusInput): Promise<ArchiveStatusResult> {
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
