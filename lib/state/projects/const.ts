/** Defines persistence policies owned by the projects registry. */
import type { FileLockOptions } from "../persistence/index.js";

/** Lock policy applied to immutable projects-registry transactions. */
export const PROJECTS_LOCK_OPTIONS: FileLockOptions = {
  retryMs: 50,
  staleMs: 30_000,
  timeoutMs: 10_000,
};
