/** Exposes worker dispatch and completion commands to their callers. */
export { dispatchTask, dispatchTaskLocked } from "./dispatch-task.js";
export { finishWork } from "./finish-work.js";
export type { DispatchOpts, DispatchResult } from "./types.js";
