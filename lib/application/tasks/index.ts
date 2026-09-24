/** Exposes managed task commands, attachment operations, and queue decisions. */
export { registerAttachmentHook } from "./attachment-hook.js";
export {
  formatAttachmentComment,
  getAttachmentPath,
  listAttachments,
  purgeIssueAttachments,
  saveAttachment,
} from "./attachments.js";
export { claimManagedTask } from "./claim-task.js";
export { createManagedTaskIssue, reconcileManagedTaskCreations } from "./creation/index.js";
export { editTaskBody } from "./edit-task-body.js";
export { getManagedTaskStatus } from "./get-task-status.js";
export { listManagedTasks } from "./list-tasks.js";
export type { ProjectionViewContext } from "./projection-summary.js";
export { summarizeTaskIssue } from "./projection-summary.js";
export { setTaskLevel } from "./set-task-level.js";
export { startTask } from "./start-task.js";
