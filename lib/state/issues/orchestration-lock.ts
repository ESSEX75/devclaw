import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { issueStatePath } from "./store.js";

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

type IssueLockOptions = {
  staleMs?: number;
  retryMs?: number;
  timeoutMs?: number;
};

type LockOwner = {
  token: string;
  acquiredAt: number;
};

export function issueOrchestrationLockPath(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
): string {
  return path.join(path.dirname(issueStatePath(workspaceDir, projectSlug)), "locks", `${issueId}.lock`);
}

export async function withIssueOrchestrationLock<T>(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  operation: () => T | Promise<T>,
  options: IssueLockOptions = {},
): Promise<T> {
  const lockPath = issueOrchestrationLockPath(workspaceDir, projectSlug, issueId);
  const owner: LockOwner = { token: randomUUID(), acquiredAt: Date.now() };

  await acquireLock(lockPath, owner, options);

  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, owner.token);
  }
}

async function acquireLock(
  lockPath: string,
  owner: LockOwner,
  options: IssueLockOptions,
): Promise<void> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (Date.now() <= deadline) {
    try {
      await fs.writeFile(lockPath, JSON.stringify(owner), { flag: "wx" });

      return;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }

    if (await removeStaleLock(lockPath, staleMs)) continue;
    if (Date.now() >= deadline) break;

    await wait(retryMs);
  }

  throw new Error(`Timed out waiting for issue orchestration lock: ${lockPath}`);
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    const acquiredAt = readAcquiredAt(raw);

    if (acquiredAt !== null && Date.now() - acquiredAt <= staleMs) return false;

    await fs.unlink(lockPath);

    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return true;

    return false;
  }
}

async function releaseLock(lockPath: string, ownerToken: string): Promise<void> {
  try {
    const raw = await fs.readFile(lockPath, "utf-8");

    if (readOwnerToken(raw) !== ownerToken) return;

    await fs.unlink(lockPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
  }
}

function readAcquiredAt(raw: string): number | null {
  const parsed = parseLockOwner(raw);

  return parsed?.acquiredAt ?? null;
}

function readOwnerToken(raw: string): string | null {
  const parsed = parseLockOwner(raw);

  return parsed?.token ?? null;
}

function parseLockOwner(raw: string): LockOwner | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof value !== "object"
    || value === null
    || !("token" in value)
    || !("acquiredAt" in value)
    || typeof value.token !== "string"
    || typeof value.acquiredAt !== "number"
  ) {
    return null;
  }

  return { token: value.token, acquiredAt: value.acquiredAt };
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
