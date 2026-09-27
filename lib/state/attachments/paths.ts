/** Bounds attachment operations to canonical issue directories and rejects linked ancestors. */

import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "../paths.js";
import { isErrnoException, LOCK_FILE_SUFFIX } from "../persistence/index.js";
import { parseProjectSlug } from "../projects/schema.js";
import { ATTACHMENTS_DIRECTORY, ATTACHMENTS_INDEX } from "./const.js";
import { attachmentNameSchema } from "./schema.js";

/** Resolve the canonical issue directory, validating identifiers before filesystem effects.
 * @param workspaceDir - Workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Positive provider issue identifier.
 */
export function attachmentDirectory(workspaceDir: string, projectSlug: string, issueId: number): string {
  try { parseProjectSlug(projectSlug); } catch { throw new Error(`Unsafe project slug "${projectSlug}".`); }

  if (!Number.isSafeInteger(issueId) || issueId <= 0) throw new Error(`Unsafe issue ID "${issueId}".`);

  return path.resolve(workspaceDir, DATA_DIR, ATTACHMENTS_DIRECTORY, projectSlug, String(issueId));
}

/** Resolve the index owned by a validated issue directory.
 * @param directory - Canonical attachment directory.
 */
export function attachmentIndexPath(directory: string): string { return path.join(directory, ATTACHMENTS_INDEX); }

/** Keep the common lock outside the issue directory removed by purge.
 * @param directory - Canonical attachment directory.
 */
export function attachmentLockPath(directory: string): string { return `${directory}${LOCK_FILE_SUFFIX}`; }

/** Resolve a persisted basename without allowing traversal.
 * @param directory - Validated issue directory.
 * @param filename - Untrusted persisted or requested basename.
 */
export function attachmentFilePath(directory: string, filename: string): string {
  return path.join(directory, attachmentNameSchema.parse(filename));
}

/** Reject links and non-directory ancestors, optionally creating each missing directory safely.
 * Existing workspace ancestors above the configured root are outside this repository's ownership.
 * @param workspaceDir - Trusted configured workspace root.
 * @param directory - Descendant directory to inspect or create.
 * @param create - Whether missing directories may be created.
 */
export async function inspectAttachmentDirectory(workspaceDir: string, directory: string, create = false): Promise<boolean> {
  const root = path.resolve(workspaceDir);
  const relative = path.relative(root, directory);

  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Attachment path escapes the workspace.");
  let current = root;

  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);

      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe attachment directory: ${current}`);
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
      if (!create) return false;
      try { await fs.mkdir(current); } catch (mkdirError) {
        if (!isErrnoException(mkdirError) || mkdirError.code !== "EEXIST") throw mkdirError;
      }

      const created = await fs.lstat(current);

      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(`Unsafe attachment directory: ${current}`, { cause: error });
    }
  }

  return true;
}

/** Reject link and directory leaves; absence is reported distinctly.
 * @param filePath - Already bounded attachment or index path.
 */
export async function inspectAttachmentFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);

    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe attachment file: ${filePath}`);

    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
