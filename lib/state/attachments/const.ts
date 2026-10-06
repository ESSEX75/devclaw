/** Filesystem identifiers and serialization policy for attachment persistence. */

import type { FileLockOptions } from "../persistence/index.js";

/** Workspace-local attachment root. */
export const ATTACHMENTS_DIRECTORY = "attachments";

/** Index filename within each issue directory. */
export const ATTACHMENTS_INDEX = "metadata.json";

/** Shared save, URL update, and purge serialization policy. */
export const ATTACHMENTS_LOCK_OPTIONS: FileLockOptions = { retryMs: 25, staleMs: 30_000, timeoutMs: 10_000 };

/** Filename characters allowed in persisted attachment paths. */
export const SAFE_ATTACHMENT_NAME = /^[a-zA-Z0-9._-]+$/;

/** Integrity hash retained by cleanup audit callers. */
export const ATTACHMENT_HASH_ALGORITHM = "sha256";
