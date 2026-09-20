/**
 * Persists archived managed-issue records independently from active runtime state.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../paths.js";
import { isErrnoException, writeJsonAtomic } from "../../persistence/index.js";
import { parseProjectSlug } from "../../projects/schema.js";
import { ARCHIVED_ISSUES_FILE_NAME } from "../const.js";
import { withIssueStoreLock } from "../persistence/index.js";
import { parseIssueArchiveStore } from "./schema.js";
import type { IssueArchiveStore, IssueArchiveUpdate } from "./types.js";

/**
 * Resolve the current issue archive path.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose archive is addressed.
 */
function issueArchivePath(workspaceDir: string, projectSlug: string): string {
  return path.join(
    workspaceDir,
    DATA_DIR,
    PROJECTS_DIRECTORY_NAME,
    parseProjectSlug(projectSlug),
    ARCHIVED_ISSUES_FILE_NAME,
  );
}

/**
 * Create an empty current issue archive.
 *
 * @param projectSlug - Canonical project that owns the archive.
 */
export function emptyIssueArchiveStore(projectSlug: string): IssueArchiveStore {
  return { projectSlug, issues: {} };
}

/**
 * Read the issue archive without creating a file when the store is absent.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose archive is read.
 */
export async function readIssueArchiveStore(workspaceDir: string, projectSlug: string): Promise<IssueArchiveStore> {
  const filePath = issueArchivePath(workspaceDir, projectSlug);

  try {
    return parseIssueArchiveStore(JSON.parse(await fs.readFile(filePath, "utf-8")), projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw contextualStoreError(filePath, error);

    return emptyIssueArchiveStore(projectSlug);
  }
}

/**
 * Atomically replace a validated issue archive for a state-owned transaction.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose archive is replaced.
 * @param store - Complete validated replacement archive.
 */
export async function writeIssueArchiveStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueArchiveStore,
): Promise<void> {
  await writeJsonAtomic(issueArchivePath(workspaceDir, projectSlug), parseIssueArchiveStore(store, projectSlug));
}

/**
 * Apply an immutable archive replacement under the shared issue-store lock.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose archive is updated.
 * @param update - Pure callback producing the complete replacement and caller result.
 */
export async function updateIssueArchiveStore<T>(
  workspaceDir: string,
  projectSlug: string,
  update: (store: Readonly<IssueArchiveStore>) => IssueArchiveUpdate<T> | Promise<IssueArchiveUpdate<T>>,
): Promise<T> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const change = await update(await readIssueArchiveStore(workspaceDir, projectSlug));

    await writeIssueArchiveStore(workspaceDir, projectSlug, change.store);

    return change.result;
  });
}

/**
 * Add file context without obscuring the original parse or I/O failure.
 *
 * @param filePath - Archive path whose read or validation failed.
 * @param error - Original filesystem, JSON, or schema failure.
 */
function contextualStoreError(filePath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error(`Cannot read issue archive ${filePath}: ${message}`, { cause: error });
}
