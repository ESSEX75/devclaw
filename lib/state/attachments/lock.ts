/** Serializes every attachment mutation with one issue-scoped filesystem lock. */

import path from "node:path";

import { withFileLock } from "../persistence/index.js";
import { ATTACHMENTS_LOCK_OPTIONS } from "./const.js";
import { attachmentDirectory, attachmentLockPath, inspectAttachmentDirectory, inspectAttachmentFile } from "./paths.js";

/** Run a mutation after validating the ancestors of its external lock file.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive issue identifier.
 * @param operation - Mutation receiving the canonical issue directory.
 */
export async function withAttachmentLock<T>(workspaceDir: string, projectSlug: string, issueId: number, operation: (directory: string) => Promise<T>): Promise<T> {
  const directory = attachmentDirectory(workspaceDir, projectSlug, issueId);

  await inspectAttachmentDirectory(workspaceDir, path.dirname(directory), true);
  const lockPath = attachmentLockPath(directory);

  await inspectAttachmentFile(lockPath);

  return withFileLock(lockPath, ATTACHMENTS_LOCK_OPTIONS, async () => {
    await inspectAttachmentDirectory(workspaceDir, path.dirname(directory));

    return operation(directory);
  });
}
