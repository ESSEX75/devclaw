/**
 * Persists resumable managed-issue creation operations independently from ready runtime state.
 * Atomic writes and scoped locks make idempotency and restart recovery durable.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ISSUE_CREATION_STATUS } from "../../../domain/index.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../paths.js";
import { isErrnoException, LOCK_FILE_SUFFIX, withFileLock, writeJsonAtomic } from "../../persistence/index.js";
import { parseProjectSlug } from "../../projects/schema.js";
import { CREATION_LOCKS_DIRECTORY_NAME, ISSUE_CREATION_LOCK_OPTIONS, ISSUE_CREATIONS_FILE_NAME } from "../const.js";
import { parseIssueCreationStore } from "./schema.js";
import type { IssueCreationStore, IssueCreationUpdate } from "./types.js";

/**
 * Resolve the durable creation operation file for a project.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operations are addressed.
 */
function issueCreationStorePath(workspaceDir: string, projectSlug: string): string {
  return path.join(
    workspaceDir,
    DATA_DIR,
    PROJECTS_DIRECTORY_NAME,
    parseProjectSlug(projectSlug),
    ISSUE_CREATIONS_FILE_NAME,
  );
}

/**
 * Create an empty current-format creation operation store.
 *
 * @param projectSlug - Project whose creation operations are initialized.
 */
export function emptyIssueCreationStore(projectSlug: string): IssueCreationStore {
  return { projectSlug, operations: {} };
}

/**
 * Read the strict creation operation store, returning an in-memory empty store when absent.
 * Missing stores are not persisted here so read-only callers cannot overwrite a concurrent locked update.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operations are read.
 */
export async function readIssueCreationStore(workspaceDir: string, projectSlug: string): Promise<IssueCreationStore> {
  const filePath = issueCreationStorePath(workspaceDir, projectSlug);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    return parseIssueCreationStore(parsed, projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw contextualStoreError(filePath, error);

    return emptyIssueCreationStore(projectSlug);
  }
}

/**
 * Add file context without obscuring the original creation-store failure.
 *
 * @param filePath - Creation store path whose read or validation failed.
 * @param error - Original filesystem, JSON, or schema failure.
 */
function contextualStoreError(filePath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error(`Cannot read issue creation store ${filePath}: ${message}`, { cause: error });
}

/**
 * Atomically replace a validated creation operation store.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operations are written.
 * @param store - Creation operation store to persist.
 */
async function writeIssueCreationStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueCreationStore,
): Promise<void> {
  const parsed = parseIssueCreationStore(store, projectSlug);

  await writeJsonAtomic(issueCreationStorePath(workspaceDir, projectSlug), parsed);
}

/**
 * Update creation operations under one per-project store lock.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operations are updated.
 * @param update - Pure callback returning store replacement and caller result.
 */
export async function updateIssueCreationStore<T>(
  workspaceDir: string,
  projectSlug: string,
  update: (store: Readonly<IssueCreationStore>) => IssueCreationUpdate<T> | Promise<IssueCreationUpdate<T>>,
): Promise<T> {
  return withFileLock(`${issueCreationStorePath(workspaceDir, projectSlug)}${LOCK_FILE_SUFFIX}`, ISSUE_CREATION_LOCK_OPTIONS, async () => {
    const store = await readIssueCreationStore(workspaceDir, projectSlug);
    const change = await update(store);

    await writeIssueCreationStore(workspaceDir, projectSlug, change.store);

    return change.result;
  });
}

/**
 * Serialize all provider and local mutations sharing one idempotency key.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operation is locked.
 * @param idempotencyKey - Deduplication key shared by creation mutations.
 * @param operation - Creation work serialized by the key lock.
 */
export async function withIssueCreationLock<T>(
  workspaceDir: string,
  projectSlug: string,
  idempotencyKey: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const lockPath = path.join(
    path.dirname(issueCreationStorePath(workspaceDir, projectSlug)),
    CREATION_LOCKS_DIRECTORY_NAME,
    `${keyHash}${LOCK_FILE_SUFFIX}`,
  );

  return withFileLock(lockPath, ISSUE_CREATION_LOCK_OPTIONS, operation);
}

/** Build identifiers shared by a newly requested creation operation. */
export function newIssueCreationIdentity(): {
  /** Stable identifier of the resumable creation operation. */
  operationId: string;
  /** Correlation identifier shared by audit records for the operation. */
  auditCorrelationId: string;
} {
  return { operationId: randomUUID(), auditCorrelationId: randomUUID() };
}

/**
 * Check whether the creation saga owning a runtime state has published it for lifecycle use.
 *
 * @param workspaceDir - Workspace containing project-local state.
 * @param projectSlug - Project whose creation operations are checked.
 * @param operationId - Optional creation saga identifier to check.
 */
export async function isIssueCreationReady(
  workspaceDir: string,
  projectSlug: string,
  operationId: string | undefined,
): Promise<boolean> {
  if (!operationId) return true;
  const store = await readIssueCreationStore(workspaceDir, projectSlug);
  const operation = Object.values(store.operations).find((candidate) => candidate.operationId === operationId);

  return operation?.status === ISSUE_CREATION_STATUS.READY;
}
