/**
 * Persists resumable managed-issue creation operations independently from ready runtime state.
 * Atomic writes and scoped locks make idempotency and restart recovery durable.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ISSUE_CREATION_STATUS } from "../../../domain/index.js";
import { DATA_DIR } from "../../paths.js";
import { type FileLockOptions,isErrnoException, withFileLock, writeJsonAtomic } from "../../persistence/index.js";
import { parseIssueCreationStore } from "./schema.js";
import type { IssueCreationStore, IssueCreationUpdate } from "./types.js";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 5 * 60_000;

/** Resolve the durable creation operation file for a project. */
export function issueCreationStorePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issue-creations.json");
}

/** Create an empty current-format creation operation store. */
export function emptyIssueCreationStore(projectSlug: string): IssueCreationStore {
  return { version: 1, projectSlug, operations: {} };
}

/** Read the strict creation operation store, creating it when absent. */
export async function readIssueCreationStore(workspaceDir: string, projectSlug: string): Promise<IssueCreationStore> {
  const filePath = issueCreationStorePath(workspaceDir, projectSlug);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    return parseIssueCreationStore(parsed, projectSlug);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
    const empty = emptyIssueCreationStore(projectSlug);

    await writeIssueCreationStore(workspaceDir, projectSlug, empty);

    return empty;
  }
}

/** Atomically replace a validated creation operation store. */
export async function writeIssueCreationStore(
  workspaceDir: string,
  projectSlug: string,
  store: IssueCreationStore,
): Promise<void> {
  const parsed = parseIssueCreationStore(store, projectSlug);

  await writeJsonAtomic(issueCreationStorePath(workspaceDir, projectSlug), parsed);
}

/** Update creation operations under one per-project store lock. */
export async function updateIssueCreationStore<T>(
  workspaceDir: string,
  projectSlug: string,
  update: (store: Readonly<IssueCreationStore>) => IssueCreationUpdate<T> | Promise<IssueCreationUpdate<T>>,
): Promise<T> {
  return withFileLock(`${issueCreationStorePath(workspaceDir, projectSlug)}.lock`, creationLockOptions(), async () => {
    const store = await readIssueCreationStore(workspaceDir, projectSlug);
    const change = await update(store);

    await writeIssueCreationStore(workspaceDir, projectSlug, change.store);

    return change.result;
  });
}

/** Serialize all provider and local mutations sharing one idempotency key. */
export async function withIssueCreationLock<T>(
  workspaceDir: string,
  projectSlug: string,
  idempotencyKey: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const lockPath = path.join(path.dirname(issueCreationStorePath(workspaceDir, projectSlug)), "creation-locks", `${keyHash}.lock`);

  return withFileLock(lockPath, creationLockOptions(), operation);
}

/** Build identifiers shared by a newly requested creation operation. */
export function newIssueCreationIdentity(): { operationId: string; auditCorrelationId: string } {
  return { operationId: randomUUID(), auditCorrelationId: randomUUID() };
}

/** Check whether the creation saga owning a runtime state has published it for lifecycle use. */
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

/** Return the lock timing policy owned by creation operation persistence. */
function creationLockOptions(): FileLockOptions {
  return { retryMs: LOCK_RETRY_MS, staleMs: LOCK_STALE_MS, timeoutMs: LOCK_TIMEOUT_MS };
}
