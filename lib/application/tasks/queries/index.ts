/** Supported queries operations for task consumers. */

export { ALL_TASK_STATES } from "./const.js";
export { getManagedTaskStatus } from "./get-task-status.js";
export { listManagedTasks } from "./list-tasks.js";
export { summarizeTaskIssue } from "./projection-summary.js";
export type { ProjectionViewContext } from "./types.js";
