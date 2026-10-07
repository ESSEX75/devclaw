/** Registers SDK media capture and passes complete normalized routing to application orchestration. */

import { extractIssueReferences, processAttachmentMessage, resolveAttachmentProject, resolveProvider } from "../../../application/index.js";
import { listConfiguredAgents, resolveConfiguredAgentWorkspace } from "../agents/index.js";
import { extractMediaAttachments } from "../media/index.js";
import { normalizeAttachmentRoute } from "./attachment-route.js";
import { ATTACHMENT_MESSAGE_HOOK } from "./const.js";
import type { AttachmentHookContext, AttachmentHookRegistrar } from "./types.js";

/** Capture media only when the SDK supplies a complete, unambiguous route and owner.
 * Scoped session ownership is required; missing account/owner never defaults to a guessed agent.
 * @param api - SDK hook registration capability.
 * @param ctx - Live runtime configuration, provider transport, and diagnostics.
 */
export function registerAttachmentHook(api: AttachmentHookRegistrar, ctx: AttachmentHookContext): void {
  api.on(ATTACHMENT_MESSAGE_HOOK, async (event, eventCtx) => {
    if (event.mediaStagingPending) return;
    const attachments = event.media
      ? extractMediaAttachments({ MediaPaths: event.media.map(media => media.path), MediaTypes: event.media.map(media => media.contentType) })
      : extractMediaAttachments(event.metadata ?? {});
    const issueIds = extractIssueReferences(event.content);

    if (!attachments.length || !issueIds.length) return;
    try {
      const route = normalizeAttachmentRoute(event, eventCtx);

      if (!route) return;
      const config = ctx.runtime.config.current();
      const configuredAgents = listConfiguredAgents(config);
      // With no explicit list, resolve the owner supplied by the SDK session using SDK defaults.
      const owners = config.agents?.entries !== undefined || config.agents?.list !== undefined
        ? configuredAgents.filter(agent => agent.id === route.agentId) : [{ id: route.agentId }];
      const workspaces = await Promise.all(owners.map(async agent => ({
        agentId: agent.id, workspaceDir: await resolveConfiguredAgentWorkspace(config, agent.id),
      })));
      const context = await resolveAttachmentProject(workspaces, route);

      if (!context) return;
      const { provider } = await resolveProvider(context.workspaceDir, context.project, ctx.runCommand);

      for (const issueId of issueIds) {
        await processAttachmentMessage({ workspaceDir: context.workspaceDir, projectSlug: context.project.slug,
          issueId, provider, uploader: event.from, mediaAttachments: attachments });
      }
    } catch (error) {
      ctx.logger.warn(`Attachment capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
