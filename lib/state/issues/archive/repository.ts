/**
 * Persists archived managed-issue records independently from active runtime state.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { ArchivedIssueRecord } from "../../../domain/index.js";
import { DATA_DIR } from "../../paths.js";
import { isErrnoException, writeJsonAtomic } from "../../persistence/index.js";
import { withIssueStoreLock } from "../active/repository.js";
import { parseIssueArchiveStore } from "./schema.js";
import type { IssueArchiveStore, IssueArchiveUpdate } from "./types.js";

/** Resolve the current issue archive path. */
export function issueArchivePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issues.archive.json");
}

/** Build the stable archive key for one provider issue. */
export function issueArchiveKey(record: Pick<ArchivedIssueRecord, "provider" | "projectSlug" | "issueId">): string {
  return `${record.provider}:${record.projectSlug}:${record.issueId}`;
}

/** Create an empty current issue archive. */
export function emptyIssueArchiveStore(projectSlug: string): IssueArchiveStore {
  return { version: 1, projectSlug, issues: {} };
}

/** Read the issue archive, creating an empty store when absent. */
export async function readIssueArchiveStore(workspaceDir: string, projectSlug: string): Promise<IssueArchiveStore> {
  const filePath = issueArchivePath(workspaceDir, projectSlug);

  try {
    return parseIssueArchiveStore(JSON.parse(await fs.readFile(filePath, "utf-8")), projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw contextualStoreError(filePath, error);
    const empty = emptyIssueArchiveStore(projectSlug);

    await writeIssueArchiveStore(workspaceDir, projectSlug, empty);

    return empty;
  }
}

/** Atomically replace a validated issue archive. */
export async function writeIssueArchiveStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueArchiveStore,
): Promise<void> {
  await writeJsonAtomic(issueArchivePath(workspaceDir, projectSlug), parseIssueArchiveStore(store, projectSlug));
}

/** Apply an immutable archive replacement under the shared issue-store lock. */
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

/** Add file context without obscuring the original parse or I/O failure. */
function contextualStoreError(filePath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error(`Cannot read issue archive ${filePath}: ${message}`, { cause: error });
}
