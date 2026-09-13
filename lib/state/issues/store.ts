/**
 * Persists active and archived managed-issue state under one project lock.
 * Archive-first transfers may temporarily duplicate a record after a crash, but never lose it.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  type ArchivedIssueRecord,
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
  NOTIFICATION_CHANNEL,
  PIPELINE_NOTIFICATION_STATUS,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../domain/index.js";
import { DATA_DIR } from "../paths.js";
import { isErrnoException, withFileLock, writeJsonAtomic } from "../persistence/index.js";
import type { IssueArchiveStore, IssueStateStore } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

const RuntimeIssueSchema = z.preprocess(normalizeRuntimeIssue, z.object({
  projectSlug: z.string(), issueId: z.number().int().positive(), provider: z.enum(ISSUE_PROVIDER),
  creationOperationId: z.string().uuid().optional(),
  workflowState: z.string(), workflowLabel: z.string(), assignedRole: z.string().nullable(),
  assignedLevel: z.string().nullable(), owner: z.string().nullable(),
  reviewPolicy: z.enum(REVIEW_POLICY).nullable(), testPolicy: z.enum(TEST_POLICY).nullable(),
  notifyTarget: z.object({ channel: z.enum(NOTIFICATION_CHANNEL), name: z.string() }).strict().nullable(),
  activeWorker: z.object({
    role: z.string(), level: z.string(), slotIndex: z.number().int().nonnegative(),
    sessionKey: z.string().nullable(), startedAt: z.string(),
  }).strict().nullable(),
  integrityStatus: z.enum(ISSUE_INTEGRITY_STATUS), integrityErrors: z.array(z.string()),
  projectionVersion: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
  closedAt: z.string().nullable(),
  providerMissing: z.object({ confirmations: z.number().int().positive(), firstConfirmedAt: z.string(), lastConfirmedAt: z.string() }).strict().nullable(),
  pipelineNotification: z.object({
    eventKey: z.string(), status: z.enum(PIPELINE_NOTIFICATION_STATUS),
    attemptedAt: z.string(), deliveredAt: z.string().optional(),
  }).strict().nullable(),
}).strict());
const IssueStateStoreSchema = z.object({ version: z.literal(2), projectSlug: z.string(), issues: z.record(z.string(), RuntimeIssueSchema) }).strict();
const ArchivedIssueSchema = z.preprocess(normalizeArchivedIssue, z.object({
  projectSlug: z.string(), issueId: z.number().int().positive(), provider: z.enum(ISSUE_PROVIDER),
  title: z.string().optional(), issueUrl: z.string().optional(), finalWorkflowState: z.string(),
  finalWorkflowLabel: z.string().optional(), archiveReason: z.enum(ISSUE_ARCHIVE_REASON),
  closedAt: z.string().nullable().optional(), providerDeletedAt: z.string().nullable().optional(),
  archivedAt: z.string(), lastIntegrityStatus: z.enum(ISSUE_INTEGRITY_STATUS),
  attachmentDisposition: z.enum(ATTACHMENT_DISPOSITION),
  sourceSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict());
const IssueArchiveStoreSchema = z.object({ version: z.literal(1), projectSlug: z.string(), issues: z.record(z.string(), ArchivedIssueSchema) }).strict();

/** Resolve the active issue state file for a project. */
export function issueStatePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issues.json");
}

/** Resolve the single issue archive file for a project. */
export function issueArchivePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issues.archive.json");
}

/** Build the stable archive key for one provider issue. */
export function issueArchiveKey(record: Pick<ArchivedIssueRecord, "provider" | "projectSlug" | "issueId">): string {
  return `${record.provider}:${record.projectSlug}:${record.issueId}`;
}

/** Create an empty active issue store using the current, non-legacy schema. */
export function emptyIssueStateStore(projectSlug: string): IssueStateStore {
  return { version: 2, projectSlug, issues: {} };
}

/** Create an empty dedicated issue archive store. */
export function emptyIssueArchiveStore(projectSlug: string): IssueArchiveStore {
  return { version: 1, projectSlug, issues: {} };
}

/** Read active issue state, creating a current-format empty store when absent. */
export async function readIssueStateStore(workspaceDir: string, projectSlug: string): Promise<IssueStateStore> {
  return readStoreFile(issueStatePath(workspaceDir, projectSlug), projectSlug, IssueStateStoreSchema, emptyIssueStateStore);
}

/** Read the dedicated archive, creating it when absent. */
export async function readIssueArchiveStore(workspaceDir: string, projectSlug: string): Promise<IssueArchiveStore> {
  return readStoreFile(issueArchivePath(workspaceDir, projectSlug), projectSlug, IssueArchiveStoreSchema, emptyIssueArchiveStore);
}

/** Atomically write active issue state. */
export async function writeIssueStateStore(workspaceDir: string, projectSlug: string, data: IssueStateStore): Promise<void> {
  await writeJsonAtomic(issueStatePath(workspaceDir, projectSlug), validateProjectStore(data, projectSlug, IssueStateStoreSchema));
}

/** Atomically write the dedicated issue archive. */
export async function writeIssueArchiveStore(workspaceDir: string, projectSlug: string, data: IssueArchiveStore): Promise<void> {
  await writeJsonAtomic(issueArchivePath(workspaceDir, projectSlug), validateProjectStore(data, projectSlug, IssueArchiveStoreSchema));
}

/** Replace both issue stores with empty current-format files after explicit operator confirmation. */
export async function resetIssueStores(workspaceDir: string, projectSlug: string): Promise<void> {
  await withIssueStoreLock(workspaceDir, projectSlug, async () => {
    await writeIssueArchiveStore(workspaceDir, projectSlug, emptyIssueArchiveStore(projectSlug));
    await writeIssueStateStore(workspaceDir, projectSlug, emptyIssueStateStore(projectSlug));
  });
}

/** Update active issue state while holding the shared project issue-store lock. */
export async function updateIssueStateStore<T>(workspaceDir: string, projectSlug: string, updater: (data: IssueStateStore) => T | Promise<T>): Promise<T> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const data = await readIssueStateStore(workspaceDir, projectSlug);
    const result = await updater(data);

    await writeIssueStateStore(workspaceDir, projectSlug, data);

    return result;
  });
}

/** Move an active issue into the archive using an idempotent archive-first write order. */
export async function archiveIssueState(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  buildRecord: (state: IssueRuntimeState) => ArchivedIssueRecord,
): Promise<ArchivedIssueRecord | null> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const active = await readIssueStateStore(workspaceDir, projectSlug);
    const archive = await readIssueArchiveStore(workspaceDir, projectSlug);
    const state = active.issues[String(issueId)];

    if (!state) return Object.values(archive.issues).find((record) => record.issueId === issueId) ?? null;
    const record = buildRecord(state);
    const key = issueArchiveKey(record);

    archive.issues[key] ??= record;
    await writeIssueArchiveStore(workspaceDir, projectSlug, archive);
    delete active.issues[String(issueId)];
    await writeIssueStateStore(workspaceDir, projectSlug, active);

    return archive.issues[key];
  });
}

/** Update the archive under the shared active/archive project lock. */
export async function updateIssueArchiveStore<T>(workspaceDir: string, projectSlug: string, updater: (data: IssueArchiveStore) => T | Promise<T>): Promise<T> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const archive = await readIssueArchiveStore(workspaceDir, projectSlug);
    const result = await updater(archive);

    await writeIssueArchiveStore(workspaceDir, projectSlug, archive);

    return result;
  });
}

async function readStoreFile<T>(filePath: string, projectSlug: string, schema: z.ZodType<T>, createEmpty: (slug: string) => T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    return validateProjectStore(parsed, projectSlug, schema);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
    const empty = createEmpty(projectSlug);

    await writeJsonAtomic(filePath, empty);

    return empty;
  }
}

function validateProjectStore<T>(data: unknown, projectSlug: string, schema: z.ZodType<T>): T {
  const parsed = schema.parse(data);

  if (!hasProjectSlug(parsed) || parsed.projectSlug !== projectSlug) {
    throw new Error(`Issue store projectSlug mismatch: expected ${projectSlug}, got ${hasProjectSlug(parsed) ? parsed.projectSlug : "missing"}`);
  }

  return parsed;
}

function hasProjectSlug(value: unknown): value is { projectSlug: string } {
  return typeof value === "object" && value !== null && "projectSlug" in value && typeof value.projectSlug === "string";
}

function normalizeRuntimeIssue(value: unknown): unknown {
  if (!isObjectRecord(value)) return value;
  const normalized = { ...value };

  delete normalized.branchContract;
  delete normalized.retryAt;
  delete normalized.retriesRemaining;

  normalized.assignedRole ??= null;
  normalized.assignedLevel ??= null;
  normalized.owner ??= null;
  normalized.reviewPolicy ??= null;
  normalized.testPolicy ??= null;
  normalized.notifyTarget ??= null;
  normalized.activeWorker ??= null;
  normalized.closedAt ??= null;
  normalized.providerMissing ??= null;
  normalized.pipelineNotification ??= null;

  return normalized;
}

function normalizeArchivedIssue(value: unknown): unknown {
  if (!isObjectRecord(value)) return value;
  const normalized = { ...value };

  delete normalized.branchContract;

  return normalized;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Run an active/archive operation under their shared project lock.
 *
 * @param workspaceDir - Workspace containing the project issue stores.
 * @param projectSlug - Project whose active and archive files share the lock.
 * @param operation - Store transaction to serialize.
 */
async function withIssueStoreLock<T>(workspaceDir: string, projectSlug: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${issueStatePath(workspaceDir, projectSlug)}.lock`;

  return withFileLock(
    lockPath,
    { retryMs: LOCK_RETRY_MS, staleMs: LOCK_STALE_MS, timeoutMs: LOCK_TIMEOUT_MS },
    operation,
  );
}
