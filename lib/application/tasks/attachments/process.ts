/** Saves incoming attachments locally before publishing them through a project provider. */
import { log as auditLog } from "../../../audit.js";
import { detectAttachmentMime } from "../../../integrations/openclaw/attachment-media.js";
import { type AttachmentMeta, readAttachmentSource, saveAttachment, updateAttachmentPublicUrl } from "../../../state/index.js";
import { ATTACHMENT_EVENT, DEFAULT_ATTACHMENT_MIME } from "./const.js";
import { formatAttachmentComment } from "./render.js";
import type { ProcessAttachmentInput } from "./types.js";

/** Persist media and confirmed upload URLs; storage failures propagate instead of reporting an empty success.
 * Provider upload/comment failures preserve usable local files and are audited without hiding local success.
 * @param input - Resolved project, provider, actor, and media references.
 */
export async function processAttachmentMessage(input: ProcessAttachmentInput): Promise<AttachmentMeta[]> {
  const { workspaceDir, projectSlug, issueId, provider, uploader } = input;

  await provider.getIssue(issueId);
  const saved: AttachmentMeta[] = [];

  for (const media of input.mediaAttachments) {
    const source = await readAttachmentSource(media.localPath);
    const filename = media.filename ?? source.filename;
    const mimeType = media.mimeType ?? await detectAttachmentMime(source.filePath, source.buffer) ?? DEFAULT_ATTACHMENT_MIME;
    let meta = await saveAttachment(workspaceDir, projectSlug, issueId, { buffer: source.buffer, filename, mimeType, uploader });
    let publicUrl: string | null = null;

    try { publicUrl = await provider.uploadAttachment(issueId, { buffer: source.buffer, filename, mimeType }); }
    catch (error) { await recordWarning(input, ATTACHMENT_EVENT.UPLOAD_ERROR, error); }

    if (publicUrl) meta = await updateAttachmentPublicUrl(workspaceDir, projectSlug, issueId, meta.id, publicUrl);
    saved.push(meta);
  }

  if (saved.length) {
    try { await provider.addComment(issueId, formatAttachmentComment(saved)); }
    catch (error) { await recordWarning(input, ATTACHMENT_EVENT.COMMENT_ERROR, error); }

    await auditLog(workspaceDir, ATTACHMENT_EVENT.ADDED, {
      project: projectSlug, issueId, uploader,
      count: saved.length, files: saved.map(file => ({ filename: file.filename, size: file.size, mimeType: file.mimeType }))
    });
  }

  return saved;
}

/** Record a secondary provider failure without discarding local attachment success.
 * @param input - Owning project and issue.
 * @param event - Stable audit event.
 * @param error - Unknown provider failure.
 */
async function recordWarning(input: ProcessAttachmentInput, event: string, error: unknown): Promise<void> {
  await auditLog(input.workspaceDir, event, {
    project: input.projectSlug, issueId: input.issueId,
    error: error instanceof Error ? error.message : String(error)
  }).catch(() => { });
}
