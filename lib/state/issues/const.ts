/** Defines storage names and lock policies shared by managed-issue repositories. */
import type { FileLockOptions } from "../persistence/index.js";

/** Filename of the active managed-issue store. */
export const ACTIVE_ISSUES_FILE_NAME = "issues.json";

/** Filename of the managed-issue archive store. */
export const ARCHIVED_ISSUES_FILE_NAME = "issues.archive.json";

/** Filename of the resumable issue-creation store. */
export const ISSUE_CREATIONS_FILE_NAME = "issue-creations.json";

/** Directory containing locks for issue-creation idempotency keys. */
export const CREATION_LOCKS_DIRECTORY_NAME = "creation-locks";

/** Directory containing per-issue application orchestration locks. */
export const ORCHESTRATION_LOCKS_DIRECTORY_NAME = "locks";

/** Lock policy shared by active and archive store transactions. */
export const ISSUE_STORE_LOCK_OPTIONS: FileLockOptions = {
  retryMs: 50,
  staleMs: 30_000,
  timeoutMs: 10_000,
};

/** Lock policy for serializing operations with one issue-creation idempotency key. */
export const ISSUE_CREATION_LOCK_OPTIONS: FileLockOptions = {
  retryMs: 50,
  staleMs: 5 * 60_000,
  timeoutMs: 10_000,
};

/** Default lock policy for one issue's application orchestration. */
export const ISSUE_ORCHESTRATION_LOCK_OPTIONS: FileLockOptions = {
  retryMs: 50,
  staleMs: 30_000,
  timeoutMs: 10_000,
};


/** Duration after which an unconfirmed terminal-notification attempt may be retried. */
export const PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS = 5 * 60_000;
