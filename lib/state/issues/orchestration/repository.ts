/**
 * Serializes application orchestration for one managed issue through state-owned locks.
 */
import path from "node:path";

import { withFileLock } from "../../persistence/index.js";
import { issueStatePath } from "../active/repository.js";

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

type IssueLockOptions = {
  /** Maximum age of a live orchestration lock. */
  staleMs?: number;
  /** Delay between contended acquisition attempts. */
  retryMs?: number;
  /** Maximum time to wait for orchestration ownership. */
  timeoutMs?: number;
};

/**
 * Resolve the lock file dedicated to one managed issue.
 *
 * @param workspaceDir - Workspace containing project-local issue state.
 * @param projectSlug - Project that owns the issue.
 * @param issueId - Provider-local issue identifier.
 */
export function issueOrchestrationLockPath(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
): string {
  return path.join(path.dirname(issueStatePath(workspaceDir, projectSlug)), "locks", `${issueId}.lock`);
}

/**
 * Run one orchestration operation while holding exclusive issue ownership.
 *
 * @param workspaceDir - Workspace containing project-local issue state.
 * @param projectSlug - Project that owns the issue.
 * @param issueId - Provider-local issue identifier.
 * @param operation - Orchestration work to serialize.
 * @param options - Optional timing overrides used primarily by tests.
 */
export async function withIssueOrchestrationLock<T>(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  operation: () => T | Promise<T>,
  options: IssueLockOptions = {},
): Promise<T> {
  const lockPath = issueOrchestrationLockPath(workspaceDir, projectSlug, issueId);

  return withFileLock(lockPath, {
    retryMs: options.retryMs ?? DEFAULT_RETRY_MS,
    staleMs: options.staleMs ?? DEFAULT_STALE_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }, operation);
}
