/** Persists attachment bytes and validated indexes with atomic replacement and shared mutation locking. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readIssueArchiveStore } from "../issues/archive/repository.js";
import { withIssueStoreLock } from "../issues/persistence/index.js";
import { writeJsonAtomic } from "../persistence/index.js";
import { withAttachmentLock } from "./lock.js";
import { attachmentDirectory, attachmentFilePath, attachmentIndexPath, inspectAttachmentDirectory, inspectAttachmentFile } from "./paths.js";
import { parseAttachmentStore } from "./schema.js";
import type { AttachmentFile, AttachmentMeta, AttachmentSource, AttachmentStore } from "./types.js";

/** Read an index; only a missing directory or index means no attachments.
 * @param workspaceDir - Configured workspace root.
 * @param directory - Canonical issue directory.
 * @param issueId - Expected owner of every metadata entry.
 */
async function readStore(workspaceDir: string, directory: string, issueId: number): Promise<AttachmentStore> {
  if (!await inspectAttachmentDirectory(workspaceDir, directory)) return { attachments: [] };
  const filePath = attachmentIndexPath(directory);

  if (!await inspectAttachmentFile(filePath)) return { attachments: [] };
  try { return parseAttachmentStore(JSON.parse(await fs.readFile(filePath, "utf8")), issueId); }
  catch (error) { throw new Error(`Cannot read attachment index ${filePath}`, { cause: error }); }
}

/** Save bytes, then publish their index entry. Failed index writes remove only the new file.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 * @param file - File bytes and display metadata.
 */
export async function saveAttachment(workspaceDir: string, projectSlug: string, issueId: number, file: AttachmentFile): Promise<AttachmentMeta> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const archive = await readIssueArchiveStore(workspaceDir, projectSlug);

    if (Object.values(archive.issues).some(record => record.issueId === issueId)) throw new Error(`Issue #${issueId} is archived and cannot accept attachments.`);

    return withAttachmentLock(workspaceDir, projectSlug, issueId, async directory => {
      const store = await readStore(workspaceDir, directory, issueId);
      const id = randomUUID();
      const meta: AttachmentMeta = {
        id, issueId, filename: file.filename, mimeType: file.mimeType,
        size: file.buffer.length, uploader: file.uploader, uploadedAt: new Date().toISOString(),
        localPath: `${id}-${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`
      };
      const next = parseAttachmentStore({ attachments: [...store.attachments, meta] }, issueId);

      await inspectAttachmentDirectory(workspaceDir, directory, true);
      const filePath = attachmentFilePath(directory, meta.localPath);

      await fs.writeFile(filePath, file.buffer, { flag: "wx" });
      try { await writeJsonAtomic(attachmentIndexPath(directory), next); }
      catch (error) {
        await fs.unlink(filePath);
        throw error;
      }

      return meta;
    });
  });
}

/** Read the validated index without creating filesystem state.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 */
export async function listAttachments(workspaceDir: string, projectSlug: string, issueId: number): Promise<AttachmentMeta[]> {
  return (await readStore(workspaceDir, attachmentDirectory(workspaceDir, projectSlug, issueId), issueId)).attachments;
}

/** Persist a confirmed upload URL against the current index; never recreate purged entries.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 * @param attachmentId - Stable file identity returned by save.
 * @param publicUrl - Provider-confirmed URL.
 */
export async function updateAttachmentPublicUrl(workspaceDir: string, projectSlug: string, issueId: number, attachmentId: string, publicUrl: string): Promise<AttachmentMeta> {
  return withAttachmentLock(workspaceDir, projectSlug, issueId, async directory => {
    const store = await readStore(workspaceDir, directory, issueId);
    const previous = store.attachments.find(file => file.id === attachmentId);

    if (!previous) throw new Error(`Attachment ${attachmentId} no longer exists on issue #${issueId}.`);
    const updated = { ...previous, publicUrl };
    const next = parseAttachmentStore({ attachments: store.attachments.map(file => file.id === attachmentId ? updated : file) }, issueId);

    await writeJsonAtomic(attachmentIndexPath(directory), next);

    return updated;
  });
}

/** Resolve a local attachment path after checking directory and file link safety.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 * @param localPath - Persisted basename only.
 */
export async function getAttachmentPath(workspaceDir: string, projectSlug: string, issueId: number, localPath: string): Promise<string> {
  const directory = attachmentDirectory(workspaceDir, projectSlug, issueId);
  const filePath = attachmentFilePath(directory, localPath);

  await inspectAttachmentDirectory(workspaceDir, directory);
  await inspectAttachmentFile(filePath);

  return filePath;
}

/** Read an explicitly supplied source file without interpreting provider or routing policy.
 * @param filePath - Local path authorized by the SDK media event or manual tool request.
 */
export async function readAttachmentSource(filePath: string): Promise<AttachmentSource> {
  const resolved = path.resolve(filePath);

  return { buffer: await fs.readFile(resolved), filename: path.basename(resolved), filePath: resolved };
}
