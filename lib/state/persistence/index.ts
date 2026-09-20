/**
 * Exposes filesystem persistence primitives only to state-owned repositories.
 */
export { writeJsonAtomic } from "./atomic-file.js";
export { LOCK_FILE_SUFFIX } from "./const.js";
export { withFileLock } from "./file-lock.js";
export { isErrnoException } from "./guards.js";
export type { FileLockOptions } from "./types.js";
