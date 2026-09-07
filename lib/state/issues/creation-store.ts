/**
 * Persists resumable managed-issue creation operations independently from ready runtime state.
 * Atomic writes and scoped locks make idempotency and restart recovery durable.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  ISSUE_CREATION_ERROR,
  ISSUE_CREATION_STATUS,
  ISSUE_PROVIDER,
  type IssueCreationStore,
  NOTIFICATION_CHANNEL,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../domain/index.js";
import { DATA_DIR } from "../setup/paths.js";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 5 * 60_000;

const CreationInputSchema = z.object({
  title: z.string(), body: z.string(), assignees: z.array(z.string()),
  workflowState: z.string(), workflowLabel: z.string(), assignedRole: z.string().nullable(),
  assignedLevel: z.string().nullable(),
  owner: z.string().nullable(), reviewPolicy: z.enum(REVIEW_POLICY), testPolicy: z.enum(TEST_POLICY),
  notifyTarget: z.object({ channel: z.enum(NOTIFICATION_CHANNEL), name: z.string() }).strict().nullable(),
  provider: z.enum(ISSUE_PROVIDER),
}).strict();
const CreationFailureSchema = z.object({
  code: z.enum(ISSUE_CREATION_ERROR), message: z.string(), retryable: z.boolean(), retryAfter: z.string().optional(),
}).strict();
const CreationOperationSchema = z.object({
  operationId: z.string().uuid(), idempotencyKey: z.string().min(1), payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  projectSlug: z.string(), requestedBy: z.string(), requestedAt: z.string(), updatedAt: z.string(),
  status: z.enum(ISSUE_CREATION_STATUS), input: CreationInputSchema, expectedLabels: z.array(z.string()),
  providerIssue: z.object({ issueId: z.number().int().positive(), url: z.string(), createdAt: z.string() }).strict().optional(),
  completedSteps: z.array(z.string()), pendingSteps: z.array(z.string()), attempts: z.number().int().nonnegative(),
  retryAfter: z.string().optional(), lastError: CreationFailureSchema.optional(), auditCorrelationId: z.string().uuid(),
}).strict();
const CreationStoreSchema = z.object({
  version: z.literal(1), projectSlug: z.string(), operations: z.record(z.string(), CreationOperationSchema),
}).strict();

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
    const store = CreationStoreSchema.parse(parsed);

    if (store.projectSlug !== projectSlug) throw new Error(`Issue creation store projectSlug mismatch for "${projectSlug}".`);

    return store;
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
  const parsed = CreationStoreSchema.parse(store);

  if (parsed.projectSlug !== projectSlug) throw new Error(`Issue creation store projectSlug mismatch for "${projectSlug}".`);
  await writeJsonAtomic(issueCreationStorePath(workspaceDir, projectSlug), parsed);
}

/** Update creation operations under one per-project store lock. */
export async function updateIssueCreationStore<T>(
  workspaceDir: string,
  projectSlug: string,
  update: (store: IssueCreationStore) => T | Promise<T>,
): Promise<T> {
  return withFileLock(`${issueCreationStorePath(workspaceDir, projectSlug)}.lock`, async () => {
    const store = await readIssueCreationStore(workspaceDir, projectSlug);
    const result = await update(store);

    await writeIssueCreationStore(workspaceDir, projectSlug, store);

    return result;
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

  return withFileLock(lockPath, operation);
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

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(temporaryPath, filePath);
}

async function withFileLock<T>(lockPath: string, operation: () => T | Promise<T>): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await operation();
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  while (Date.now() < deadline) {
    try {
      await fs.writeFile(lockPath, String(Date.now()), { flag: "wx" });

      return;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockPath)) continue;
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  throw new Error(`Timed out waiting for issue creation lock ${lockPath}`);
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const createdAt = Number(await fs.readFile(lockPath, "utf-8"));

    if (Number.isFinite(createdAt) && Date.now() - createdAt <= LOCK_STALE_MS) return false;
    await fs.rm(lockPath, { force: true });

    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
