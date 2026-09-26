/** Loads persisted attachment references for worker task context. */
import { getAttachmentPath, listAttachments } from "../../../state/index.js";
import { renderAttachmentsForTask } from "./render.js";

/** Enrich the worker message with current persisted attachments; absence produces no section.
 * @param workspaceDir - Configured workspace root.
 * @param projectSlug - Canonical project identifier.
 * @param issueId - Provider-local issue identifier.
 */
export async function formatAttachmentsForTask(workspaceDir: string, projectSlug: string, issueId: number): Promise<string> {
  const attachments = await listAttachments(workspaceDir, projectSlug, issueId);
  const display = await Promise.all(attachments.map(async file => ({
    ...file,
    fullPath: await getAttachmentPath(workspaceDir, projectSlug, issueId, file.localPath)
  })));

  return renderAttachmentsForTask(display);
}
