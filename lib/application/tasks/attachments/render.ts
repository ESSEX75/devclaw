/** Formats attachment comments and task context without filesystem or provider I/O. */

import type { AttachmentMeta } from "../../../state/index.js";
import { ATTACHMENT_SIZE_UNIT, IMAGE_MIME_PREFIX } from "./const.js";
import type { AttachmentDisplay } from "./types.js";

/** Render provider-facing attachment references.
 * @param attachments - Successfully persisted file metadata.
 */
export function formatAttachmentComment(attachments: AttachmentMeta[]): string {
  if (attachments.length === 0) return "";

  const lines = ["📎 **Attachment(s) added via DevClaw:**", ""];

  for (const a of attachments) {
    const sizeStr = formatSize(a.size);
    const isImage = a.mimeType.startsWith(IMAGE_MIME_PREFIX);

    if (isImage && a.publicUrl) {
      lines.push(`![${a.filename}](${a.publicUrl})`);
      lines.push(`*${a.filename}* (${sizeStr}) — uploaded by ${a.uploader}`);
    } else if (a.publicUrl) {
      lines.push(`- [${a.filename}](${a.publicUrl}) (${a.mimeType}, ${sizeStr}) — uploaded by ${a.uploader}`);
    } else {
      lines.push(`- **${a.filename}** (${a.mimeType}, ${sizeStr}) — uploaded by ${a.uploader}`);
      lines.push(`  _File stored locally. Use \`task_attach\` tool to access._`);
    }
  }

  lines.push("", `_Attached at ${new Date().toISOString()}_`);

  return lines.join("\n");
}

/** Render byte size for user and worker context.
 * @param bytes - Persisted file size.
 */
function formatSize(bytes: number): string {
  if (bytes < ATTACHMENT_SIZE_UNIT) return `${bytes} B`;
  if (bytes < ATTACHMENT_SIZE_UNIT * ATTACHMENT_SIZE_UNIT) return `${(bytes / ATTACHMENT_SIZE_UNIT).toFixed(1)} KB`;

  return `${(bytes / (ATTACHMENT_SIZE_UNIT * ATTACHMENT_SIZE_UNIT)).toFixed(1)} MB`;
}

/** Render attachment references for a worker task message.
 * @param attachments - Metadata with validated local paths.
 */
export function renderAttachmentsForTask(attachments: AttachmentDisplay[]): string {
  if (attachments.length === 0) return "";

  const lines = ["", "## Attachments", ""];

  for (const a of attachments) {
    const sizeStr = formatSize(a.size);
    const date = new Date(a.uploadedAt).toLocaleString();

    if (a.publicUrl) {
      lines.push(`- [${a.filename}](${a.publicUrl}) (${a.mimeType}, ${sizeStr}) — by ${a.uploader} on ${date}`);
    } else {
      const fullPath = a.fullPath;

      lines.push(`- ${a.filename} (${a.mimeType}, ${sizeStr}) — by ${a.uploader} on ${date}`);
      lines.push(`  Local path: ${fullPath}`);
    }
  }

  return lines.join("\n");
}
