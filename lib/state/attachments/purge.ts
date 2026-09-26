/** Removes only validated flat attachment directories while holding the shared issue attachment lock. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import { ATTACHMENT_HASH_ALGORITHM, ATTACHMENTS_INDEX } from "./const.js";
import { withAttachmentLock } from "./lock.js";
import { attachmentFilePath, inspectAttachmentDirectory, inspectAttachmentFile } from "./paths.js";
import type { AttachmentPurgeManifestEntry } from "./types.js";

/** Validate every entry before deletion; reject junctions, symlinks, and nested directories.
 * Uses individual unlinks and rmdir rather than recursive traversal. A retry can finish partial cleanup.
 * @param workspaceDir - Trusted configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 */
export async function purgeIssueAttachments(workspaceDir: string, projectSlug: string, issueId: number): Promise<AttachmentPurgeManifestEntry[]> {
  return withAttachmentLock(workspaceDir, projectSlug, issueId, async directory => {
    if (!await inspectAttachmentDirectory(workspaceDir, directory)) return [];
    const manifest: AttachmentPurgeManifestEntry[] = [];

    for (const filename of await fs.readdir(directory)) {
      const filePath = attachmentFilePath(directory, filename);

      await inspectAttachmentFile(filePath);
      const content = await fs.readFile(filePath);

      manifest.push({ filename, size: content.length, sha256: createHash(ATTACHMENT_HASH_ALGORITHM).update(content).digest("hex") });
    }

    // Keep the index until all bytes are removed so partial cleanup remains discoverable.
    manifest.sort((a, b) => Number(a.filename === ATTACHMENTS_INDEX) - Number(b.filename === ATTACHMENTS_INDEX));
    for (const entry of manifest) {
      await inspectAttachmentDirectory(workspaceDir, directory);
      const filePath = attachmentFilePath(directory, entry.filename);

      await inspectAttachmentFile(filePath);
      await fs.unlink(filePath);
    }

    await fs.rmdir(directory);

    return manifest;
  });
}
