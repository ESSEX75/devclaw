/** Couples attachment cleanup with a conditional archive mutation under the shared issue-store lock. */
import fs from "node:fs/promises";
import path from "node:path";

import { ATTACHMENT_DISPOSITION } from "../../../domain/index.js";
import { purgeIssueAttachments } from "../../attachments/purge.js";
import type { AttachmentPurgeManifestEntry } from "../../attachments/types.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../paths.js";
import { parseProjectSlug } from "../../projects/schema.js";
import { readIssueStateStore } from "../active/repository.js";
import { ARCHIVE_RETENTION_AUDIT_FILE_NAME } from "../const.js";
import { withIssueStoreLock } from "../persistence/index.js";
import { issueArchiveKey } from "./identity.js";
import { readIssueArchiveStore, writeIssueArchiveStore } from "./repository.js";
import type { ArchiveRetentionMutation, ArchiveRetentionMutationResult } from "./types.js";

/** Recheck the full record and active-store absence before destructive cleanup.
 * Failed cleanup, checkpoint, or commit leaves the recovery record available for another attempt.
 * @param workspaceDir - Workspace containing archive and attachment storage.
 * @param projectSlug - Canonical project addressing both stores.
 * @param input - Expected record, application retention decision, and durable deletion checkpoint.
 */
export async function applyArchiveRetention(workspaceDir: string, projectSlug: string, input: ArchiveRetentionMutation): Promise<ArchiveRetentionMutationResult> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const archive = await readIssueArchiveStore(workspaceDir, projectSlug);
    const key = issueArchiveKey(input.expected);
    const record = archive.issues[key];
    const active = await readIssueStateStore(workspaceDir, projectSlug);

    if (!record || JSON.stringify(record) !== JSON.stringify(input.expected) || active.issues[String(record.issueId)]) {
      return { applied: false, attachmentsPurged: false, recordRemoved: false };
    }

    const manifest = await purgeIssueAttachments(workspaceDir, projectSlug, record.issueId, async files => {
      await writePurgeIntent(workspaceDir, projectSlug, input, files);
      await input.beforeDelete(files);
    });
    const issues = { ...archive.issues };

    if (input.removeRecord) delete issues[key];
    else issues[key] = { ...record, attachmentDisposition: manifest.length ? ATTACHMENT_DISPOSITION.PURGED : ATTACHMENT_DISPOSITION.NONE };
    await writeIssueArchiveStore(workspaceDir, projectSlug, { ...archive, issues });

    return { applied: true, attachmentsPurged: record.attachmentDisposition === ATTACHMENT_DISPOSITION.RETAINED || manifest.length > 0, recordRemoved: input.removeRecord };
  });
}

/** Persist deletion evidence without the best-effort behavior of the general application audit log.
 * @param workspaceDir - Workspace containing the existing project store directory.
 * @param projectSlug - Canonical owning project.
 * @param input - Exact archive identity and requested cleanup operation.
 * @param manifest - Complete validated file set captured before the first unlink.
 */
async function writePurgeIntent(workspaceDir: string, projectSlug: string, input: ArchiveRetentionMutation, manifest: readonly AttachmentPurgeManifestEntry[]): Promise<void> {
  const file = path.join(workspaceDir, DATA_DIR, PROJECTS_DIRECTORY_NAME, parseProjectSlug(projectSlug), ARCHIVE_RETENTION_AUDIT_FILE_NAME);

  await fs.appendFile(file, JSON.stringify({ requestedAt: new Date().toISOString(), record: input.expected, removeRecord: input.removeRecord, manifest }) + "\n", "utf8");
}
