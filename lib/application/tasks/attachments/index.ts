/** Supported attachment orchestration and context enrichment API. */

export { manageTaskAttachments } from "./command.js";
export { formatAttachmentsForTask } from "./context.js";
export { processAttachmentMessage } from "./process.js";
export { formatAttachmentComment } from "./render.js";
export { extractIssueReferences, resolveAttachmentProject } from "./routing.js";
export type { AttachmentMessageRoute, AttachmentWorkspace } from "./types.js";
