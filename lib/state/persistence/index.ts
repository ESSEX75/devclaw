/**
 * Exposes filesystem persistence primitives only to state-owned repositories.
 */

export { writeJsonAtomic } from "./atomic-file.js";
export { CREATE_ONLY_FILE_FLAG, FILESYSTEM_ERROR_CODE, LOCK_FILE_SUFFIX, STATE_TEXT_ENCODING } from "./const.js";
export { withFileLock } from "./file-lock.js";
export { isErrnoException } from "./guards.js";
export type { FileLockOptions } from "./types.js";
