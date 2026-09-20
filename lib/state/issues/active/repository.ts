/**
 * Persists current active managed-issue state under its project-level store lock.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../paths.js";
import { isErrnoException, writeJsonAtomic } from "../../persistence/index.js";
import { parseProjectSlug } from "../../projects/schema.js";
import { ACTIVE_ISSUES_FILE_NAME } from "../const.js";
import { withIssueStoreLock } from "../persistence/index.js";
import { parseIssueStateStore } from "./schema.js";
import type { IssueStateStore, IssueStateUpdate } from "./types.js";

/**
 * Resolve the current active issue store path.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose active store is addressed.
 */
export function issueStatePath(workspaceDir: string, projectSlug: string): string {
  return path.join(
    workspaceDir,
    DATA_DIR,
    PROJECTS_DIRECTORY_NAME,
    parseProjectSlug(projectSlug),
    ACTIVE_ISSUES_FILE_NAME,
  );
}

/**
 * Create an empty current active issue store.
 *
 * @param projectSlug - Canonical project that owns the store.
 */
export function emptyIssueStateStore(projectSlug: string): IssueStateStore {
  return { projectSlug, issues: {} };
}

/**
 * Read current active issue state without creating a file when the store is absent.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose active store is read.
 */
export async function readIssueStateStore(workspaceDir: string, projectSlug: string): Promise<IssueStateStore> {
  const filePath = issueStatePath(workspaceDir, projectSlug);

  try {
    return parseIssueStateStore(JSON.parse(await fs.readFile(filePath, "utf-8")), projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw contextualStoreError(filePath, error);

    return emptyIssueStateStore(projectSlug);
  }
}

/**
 * Atomically replace validated active issue state for a state-owned transaction.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose active store is replaced.
 * @param store - Complete validated replacement store.
 */
export async function writeIssueStateStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueStateStore,
): Promise<void> {
  await writeJsonAtomic(issueStatePath(workspaceDir, projectSlug), parseIssueStateStore(store, projectSlug));
}

/**
 * Apply an immutable active-store replacement under the shared issue-store lock.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Canonical project whose active store is updated.
 * @param update - Pure callback producing the complete replacement and caller result.
 */
export async function updateIssueStateStore<T>(
  workspaceDir: string,
  projectSlug: string,
  update: (store: Readonly<IssueStateStore>) => IssueStateUpdate<T> | Promise<IssueStateUpdate<T>>,
): Promise<T> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const change = await update(await readIssueStateStore(workspaceDir, projectSlug));

    await writeIssueStateStore(workspaceDir, projectSlug, change.store);

    return change.result;
  });
}

/**
 * Add file context without obscuring the original parse or I/O failure.
 *
 * @param filePath - Store path whose read or validation failed.
 * @param error - Original filesystem, JSON, or schema failure.
 */
function contextualStoreError(filePath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error(`Cannot read active issue store ${filePath}: ${message}`, { cause: error });
}
