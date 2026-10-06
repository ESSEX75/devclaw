/** Attachment persistence API exposed through the state root. */

export { purgeIssueAttachments } from "./purge.js";
export { getAttachmentPath, listAttachments, readAttachmentSource, saveAttachment, updateAttachmentPublicUrl } from "./repository.js";
export type { AttachmentFile, AttachmentMeta, AttachmentPurgeManifestEntry } from "./types.js";
