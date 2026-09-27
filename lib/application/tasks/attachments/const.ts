/** Attachment command identifiers and bounded presentation policy. */

/** Supported manual attachment actions. */
export const ATTACHMENT_ACTION = { LIST: "list", GET: "get", ADD: "add" } as const;

/** Fallback media type for unknown file formats. */
export const DEFAULT_ATTACHMENT_MIME = "application/octet-stream";

/** Media prefix for image rendering. */
export const IMAGE_MIME_PREFIX = "image/";

/** Byte unit used by attachment display formatting. */
export const ATTACHMENT_SIZE_UNIT = 1024;

/** Preserve the established issue-reference recognition limit. */
export const MAX_ATTACHMENT_ISSUE_ID = 100_000;

/** Audit events emitted by attachment orchestration. */
export const ATTACHMENT_EVENT = {
  UPLOAD_ERROR: "attachment_upload_error",
  COMMENT_ERROR: "attachment_comment_error",
  ADDED: "attachments_added",
} as const;
