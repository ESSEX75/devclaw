/** Supported task creation, lifecycle, query, attachment, and worker-context APIs. */
export { extractIssueReferences, formatAttachmentsForTask, manageTaskAttachments, processAttachmentMessage, resolveAttachmentProject } from "./attachments/index.js";
export { buildAnnouncement, buildConflictFixMessage, buildTaskMessage, formatSessionLabel } from "./context/index.js";
export { createManagedTaskIssue, reconcileManagedTaskCreations } from "./creation/index.js";
export { claimManagedTask, editTaskBody, resolveRoleLevel, setTaskLevel, startTask } from "./lifecycle/index.js";
export type { ProjectionViewContext } from "./queries/index.js";
export { getManagedTaskStatus, listManagedTasks, summarizeTaskIssue } from "./queries/index.js";
