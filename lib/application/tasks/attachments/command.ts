/** Coordinates manual attachment commands independently of OpenClaw tool formatting. */

import { getAttachmentPath, listAttachments } from "../../../state/index.js";
import { resolveProject, resolveProvider } from "../../projects/index.js";
import { ATTACHMENT_ACTION } from "./const.js";
import { processAttachmentMessage } from "./process.js";
import type { TaskAttachmentInput } from "./types.js";

/** List, resolve, or add a file through the same persistence/upload flow used by message capture.
 * @param input - Validated tool operation and runtime provider transport.
 */
export async function manageTaskAttachments(input: TaskAttachmentInput) {
  const { workspaceDir, issueId } = input;
  const { project } = await resolveProject(workspaceDir, input.channelId);

  if (input.action === ATTACHMENT_ACTION.LIST) {
    const attachments = await Promise.all((await listAttachments(workspaceDir, project.slug, issueId)).map(async file => ({
      ...file,
      publicUrl: file.publicUrl ?? null, localPath: await getAttachmentPath(workspaceDir, project.slug, issueId, file.localPath)
    })));

    return { success: true, issueId, project: project.name, attachments, count: attachments.length };
  }

  if (input.action === ATTACHMENT_ACTION.GET) {
    if (!input.attachmentId) throw new Error("attachmentId is required for 'get' action");
    const attachment = (await listAttachments(workspaceDir, project.slug, issueId)).find(file => file.id === input.attachmentId);

    if (!attachment) throw new Error(`Attachment ${input.attachmentId} not found on issue #${issueId}`);

    return {
      success: true, issueId, project: project.name, attachment: {
        ...attachment,
        fullPath: await getAttachmentPath(workspaceDir, project.slug, issueId, attachment.localPath)
      }
    };
  }

  if (!input.filePath) throw new Error("filePath is required for 'add' action");
  const { provider } = await resolveProvider(workspaceDir, project, input.runCommand);
  const [attachment] = await processAttachmentMessage({
    workspaceDir, projectSlug: project.slug, issueId, provider,
    uploader: "manual", mediaAttachments: [{ localPath: input.filePath }]
  });

  if (!attachment) throw new Error("The attachment could not be persisted.");

  return {
    success: true, issueId, project: project.name, attachment: {
      ...attachment,
      localPath: await getAttachmentPath(workspaceDir, project.slug, issueId, attachment.localPath)
    },
    announcement: `📎 File "${attachment.filename}" attached to #${issueId}`
  };
}
