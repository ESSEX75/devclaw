/**
 * Persists current active managed-issue state under its project-level store lock.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "../../paths.js";
import { isErrnoException, withFileLock, writeJsonAtomic } from "../../persistence/index.js";
import { parseIssueStateStore } from "./schema.js";
import type { IssueStateStore, IssueStateUpdate } from "./types.js";

const STORE_LOCK_OPTIONS = { retryMs: 50, staleMs: 30_000, timeoutMs: 10_000 };

/** Resolve the current active issue store path. */
export function issueStatePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issues.json");
}

/** Create an empty current active issue store. */
export function emptyIssueStateStore(projectSlug: string): IssueStateStore {
  return { version: 2, projectSlug, issues: {} };
}

/** Read current active issue state, creating an empty store when absent. */
export async function readIssueStateStore(workspaceDir: string, projectSlug: string): Promise<IssueStateStore> {
  const filePath = issueStatePath(workspaceDir, projectSlug);

  try {
    return parseIssueStateStore(JSON.parse(await fs.readFile(filePath, "utf-8")), projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw contextualStoreError(filePath, error);
    const empty = emptyIssueStateStore(projectSlug);

    await writeIssueStateStore(workspaceDir, projectSlug, empty);

    return empty;
  }
}

/** Atomically replace validated active issue state. */
export async function writeIssueStateStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueStateStore,
): Promise<void> {
  await writeJsonAtomic(issueStatePath(workspaceDir, projectSlug), parseIssueStateStore(store, projectSlug));
}

/** Apply an immutable active-store replacement under the shared issue-store lock. */
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

/** Run an active/archive transaction under their shared project lock. */
export async function withIssueStoreLock<T>(
  workspaceDir: string,
  projectSlug: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withFileLock(`${issueStatePath(workspaceDir, projectSlug)}.lock`, STORE_LOCK_OPTIONS, operation);
}

/** Add file context without obscuring the original parse or I/O failure. */
function contextualStoreError(filePath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error(`Cannot read active issue store ${filePath}: ${message}`, { cause: error });
}
