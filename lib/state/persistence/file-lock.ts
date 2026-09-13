/**
 * Serializes state repository operations through token-owned filesystem locks.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { isErrnoException } from "./guards.js";

/** Timing policy selected by the repository that owns a lock. */
export type FileLockOptions = {
  /** Maximum time to wait before rejecting lock acquisition. */
  timeoutMs: number;
  /** Delay between attempts while another valid owner holds the lock. */
  retryMs: number;
  /** Maximum lock age before recovery may remove it. */
  staleMs: number;
};

type LockRecord = {
  token: string;
  createdAt: number;
};

/**
 * Run an operation while holding a token-owned lock and release only that ownership token.
 *
 * @param lockPath - Lock file scoped by the calling repository.
 * @param options - Repository-specific wait and stale-lock policy.
 * @param operation - Work that must be serialized by the lock.
 */
export async function withFileLock<T>(
  lockPath: string,
  options: FileLockOptions,
  operation: () => T | Promise<T>,
): Promise<T> {
  const owner: LockRecord = { token: randomUUID(), createdAt: Date.now() };

  await acquireLock(lockPath, owner, options);
  try {
    return await operation();
  } finally {
    await removeLockOwnedBy(lockPath, owner.token);
  }
}

/**
 * Acquire a new lock or recover an invalid or stale lock before the timeout.
 *
 * @param lockPath - Lock file to create exclusively.
 * @param owner - Token and acquisition time persisted for this caller.
 * @param options - Repository-specific wait and stale-lock policy.
 */
async function acquireLock(
  lockPath: string,
  owner: LockRecord,
  options: FileLockOptions,
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;

  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  while (Date.now() <= deadline) {
    try {
      await fs.writeFile(lockPath, JSON.stringify(owner), { flag: "wx" });

      return;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }

    if (await removeStaleLock(lockPath, options.staleMs)) continue;
    if (Date.now() >= deadline) break;
    await wait(options.retryMs);
  }

  throw new Error(`Timed out waiting for state lock: ${lockPath}`);
}

/**
 * Remove a stale lock only while it still carries the observed ownership token.
 * Invalid lock content is recoverable because it cannot identify a live owner.
 *
 * @param lockPath - Existing lock candidate.
 * @param staleMs - Maximum accepted age for a valid lock.
 */
async function removeStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const record = parseLockRecord(await fs.readFile(lockPath, "utf-8"));

    if (record && Date.now() - record.createdAt <= staleMs) return false;
    if (record) return removeLockOwnedBy(lockPath, record.token);
    await fs.rm(lockPath, { force: true });

    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT";
  }
}

/**
 * Remove a lock only when its current token still belongs to the expected owner.
 *
 * @param lockPath - Lock file that may still exist.
 * @param ownerToken - Ownership token allowed to release the lock.
 */
async function removeLockOwnedBy(lockPath: string, ownerToken: string): Promise<boolean> {
  try {
    const record = parseLockRecord(await fs.readFile(lockPath, "utf-8"));

    if (record?.token !== ownerToken) return false;
    await fs.rm(lockPath, { force: true });

    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return true;
    throw error;
  }
}

/**
 * Parse the strict persisted lock contract.
 *
 * @param raw - Raw lock file content.
 */
function parseLockRecord(raw: string): LockRecord | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isStrictLockRecord(value)) return null;

  return { token: value.token, createdAt: value.createdAt };
}

/**
 * Validate exact membership in the lock record contract.
 *
 * @param value - Parsed JSON candidate.
 */
function isStrictLockRecord(value: unknown): value is LockRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);

  return keys.length === 2
    && keys.includes("token")
    && keys.includes("createdAt")
    && "token" in value
    && typeof value.token === "string"
    && value.token.length > 0
    && "createdAt" in value
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt);
}

/**
 * Wait before retrying a contended lock.
 *
 * @param milliseconds - Delay selected by the owning repository.
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
