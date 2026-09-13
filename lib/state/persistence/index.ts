/**
 * Exposes filesystem persistence primitives only to state-owned repositories.
 */
export { writeFileAtomic, writeJsonAtomic } from "./atomic-file.js";
export type { FileLockOptions } from "./file-lock.js";
export { withFileLock } from "./file-lock.js";
export { isErrnoException } from "./guards.js";
