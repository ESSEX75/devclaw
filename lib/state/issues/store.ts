/**
 * issues/state.ts — File I/O and locking for project-local issues.json.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { IssueStateStore } from "../../domain/issues/types.js";
import { DATA_DIR } from "../setup/paths.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

export function issueStatePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects", projectSlug, "issues.json");
}

function issueStateLockPath(workspaceDir: string, projectSlug: string): string {
  return issueStatePath(workspaceDir, projectSlug) + ".lock";
}

export function emptyIssueStateStore(projectSlug: string): IssueStateStore {
  return {
    version: 1,
    projectSlug,
    issues: {},
    archive: {
      issues: {},
    },
  };
}

async function acquireIssueStateLock(workspaceDir: string, projectSlug: string): Promise<void> {
  const lock = issueStateLockPath(workspaceDir, projectSlug);

  await fs.mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fs.writeFile(lock, String(Date.now()), { flag: "wx" });

      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;

      if (e.code !== "EEXIST") throw err;

      try {
        const content = await fs.readFile(lock, "utf-8");
        const lockTime = Number(content);

        if (Date.now() - lockTime > LOCK_STALE_MS) {
          try { await fs.unlink(lock); } catch { /* race */ }

          continue;
        }
      } catch { /* lock disappeared — retry */ }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  try { await fs.unlink(lock); } catch { /* ignore */ }

  await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
}

async function releaseIssueStateLock(workspaceDir: string, projectSlug: string): Promise<void> {
  try { await fs.unlink(issueStateLockPath(workspaceDir, projectSlug)); } catch { /* already removed */ }
}

function normalizeIssueStateStore(data: unknown, projectSlug: string): IssueStateStore {
  const store = data as Partial<IssueStateStore>;

  if (store.projectSlug !== projectSlug) {
    throw new Error(`issues.json projectSlug mismatch: expected ${projectSlug}, got ${String(store.projectSlug)}`);
  }

  if (store.version !== 1) {
    throw new Error(`Unsupported issues.json version: ${String(store.version)}`);
  }

  return {
    version: 1,
    projectSlug,
    issues: store.issues ?? {},
    archive: {
      issues: store.archive?.issues ?? {},
    },
  };
}

async function readIssueStateStoreFile(
  workspaceDir: string,
  projectSlug: string,
): Promise<IssueStateStore> {
  const filePath = issueStatePath(workspaceDir, projectSlug);

  try {
    const raw = await fs.readFile(filePath, "utf-8");

    return normalizeIssueStateStore(JSON.parse(raw) as unknown, projectSlug);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    if (e.code !== "ENOENT") throw err;

    const empty = emptyIssueStateStore(projectSlug);

    await writeIssueStateStoreFile(workspaceDir, projectSlug, empty);

    return empty;
  }
}

async function writeIssueStateStoreFile(
  workspaceDir: string,
  projectSlug: string,
  data: IssueStateStore,
): Promise<void> {
  const normalized = normalizeIssueStateStore(data, projectSlug);
  const filePath = issueStatePath(workspaceDir, projectSlug);
  const tmpPath = filePath + ".tmp";

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function readIssueStateStore(
  workspaceDir: string,
  projectSlug: string,
): Promise<IssueStateStore> {
  return readIssueStateStoreFile(workspaceDir, projectSlug);
}

export async function writeIssueStateStore(
  workspaceDir: string,
  projectSlug: string,
  data: IssueStateStore,
): Promise<void> {
  await writeIssueStateStoreFile(workspaceDir, projectSlug, data);
}

export async function updateIssueStateStore<T>(
  workspaceDir: string,
  projectSlug: string,
  updater: (data: IssueStateStore) => T | Promise<T>,
): Promise<T> {
  await acquireIssueStateLock(workspaceDir, projectSlug);
  try {
    const data = await readIssueStateStoreFile(workspaceDir, projectSlug);
    const result = await updater(data);

    await writeIssueStateStoreFile(workspaceDir, projectSlug, data);

    return result;
  } finally {
    await releaseIssueStateLock(workspaceDir, projectSlug);
  }
}
