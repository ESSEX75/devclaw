/**
 * Serializes state repository operations through token-owned filesystem locks.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { LOCK_RENEWAL_INTERVAL_DIVISOR } from "./const.js";
import { isErrnoException } from "./guards.js";
import type { FileLockOptions } from "./types.js";

/** Ownership record persisted inside a filesystem lock. */
type LockRecord = {
  /** Unique token proving which caller owns the lock. */
  token: string;
  /** Acquisition timestamp used to determine whether ownership is stale. */
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
  let renewalFailure: unknown;
  let pendingRenewal = Promise.resolve();
  const renewalTimer = setInterval(() => {
    pendingRenewal = pendingRenewal.then(async () => {
      if (!await renewLockOwnedBy(lockPath, owner.token)) {
        throw new Error(`Lost ownership of state lock: ${lockPath}`);
      }
    }).catch((error: unknown) => {
      renewalFailure ??= error;
    });
  }, Math.max(1, Math.floor(options.staleMs / LOCK_RENEWAL_INTERVAL_DIVISOR)));

  renewalTimer.unref();
  try {
    const result = await operation();

    if (renewalFailure) {
      throw new Error(`Cannot safely complete operation after losing state lock: ${lockPath}`, {
        cause: renewalFailure,
      });
    }

    return result;
  } finally {
    clearInterval(renewalTimer);
    await pendingRenewal;
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
    const [raw, stats] = await Promise.all([
      fs.readFile(lockPath, "utf-8"),
      fs.stat(lockPath),
    ]);
    const record = parseLockRecord(raw);

    if (Date.now() - stats.mtimeMs <= staleMs) return false;
    if (record) return removeLockOwnedBy(lockPath, record.token);
    await fs.rm(lockPath, { force: true });

    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT";
  }
}

/**
 * Refresh one live lock lease only while its ownership token is still current.
 *
 * @param lockPath - Lock file whose modification time represents the live lease.
 * @param ownerToken - Ownership token allowed to renew the lease.
 */
async function renewLockOwnedBy(lockPath: string, ownerToken: string): Promise<boolean> {
  try {
    const record = parseLockRecord(await fs.readFile(lockPath, "utf-8"));

    if (record?.token !== ownerToken) return false;
    const now = new Date();

    await fs.utimes(lockPath, now, now);

    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
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
