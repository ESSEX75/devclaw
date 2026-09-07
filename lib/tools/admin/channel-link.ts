/**
 * channel_link — Attach this chat to a project.
 *
 * Links an exact account/chat route to a registered project after validating
 * its owning agent and OpenClaw binding. Existing project ownership is never
 * changed implicitly.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import {
  validateDestinationAvailability,
  validateProjectRoute,
} from "../../application/setup/index.js";
import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import {
  isNotificationChannel,
  NOTIFICATION_CHANNEL,
  type NotificationEndpoint,
} from "../../domain/index.js";
import { readProjects, writeProjects } from "../../state/projects/index.js";
import { requireWorkspaceDir } from "../helpers.js";

export function createChannelLinkTool(ctx: PluginContext) {

  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "channel_link",
    label: "Channel Link",
    description:
      "Link an explicitly bound account/chat route to a project. Conflicting project ownership is rejected.",
    parameters: {
      type: "object",
      required: ["channelId", "accountId", "project"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). " +
            "Do NOT guess; use the ID of the conversation this message came from.",
        },
        accountId: {
          type: "string",
          description: "Explicit OpenClaw channel account ID for this destination.",
        },
        project: {
          type: "string",
          description:
            "Project name or slug to link to (e.g. 'devclaw'). Must already be registered via project_register.",
        },
        channel: {
          type: "string",
          enum: Object.values(NOTIFICATION_CHANNEL),
          description: "Channel type. Defaults to 'telegram'.",
        },
        threadId: {
          type: "string",
          description:
            "Optional thread/topic ID for forum-style channels, e.g. Telegram topic ID.",
        },
        name: {
          type: "string",
          description:
            "Display name for this channel (e.g. 'general', 'dev-chat'). Auto-generated if omitted.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = params.channelId as string;
      const accountId = typeof params.accountId === "string" ? params.accountId.trim() : "";
      const projectRef = params.project as string;
      const channelTypeInput = params.channel ?? NOTIFICATION_CHANNEL.TELEGRAM;

      if (!isNotificationChannel(channelTypeInput)) {
        throw new Error(`Unsupported notification channel: ${String(channelTypeInput)}.`);
      }

      const channelType = channelTypeInput;
      const threadId = typeof params.threadId === "string" && params.threadId.trim()
        ? params.threadId.trim()
        : undefined;
      const channelName = params.name as string | undefined;
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const agentId = toolCtx.agentId;

      if (!channelId) throw new Error("channelId is required.");
      if (!accountId) throw new Error("accountId is required.");
      if (!projectRef) throw new Error("project is required.");
      if (!agentId) throw new Error("Channel linking requires an agent context.");

      const data = await readProjects(workspaceDir);

      // Resolve target project by slug or name
      const slug = projectRef.toLowerCase().replace(/\s+/g, "-");
      const target =
        data.projects[slug] ??
        Object.values(data.projects).find(
          (p) => p.name.toLowerCase() === projectRef.toLowerCase(),
        );

      if (!target) {
        const available = Object.values(data.projects)
          .map((p) => p.name)
          .join(", ");

        throw new Error(
          `Project "${projectRef}" not found. Available projects: ${available || "none"}. ` +
          `Register a project first with project_register.`,
        );
      }

      if (target.agentId !== agentId) {
        throw new Error(`Project "${target.name}" belongs to agent "${target.agentId}", not "${agentId}".`);
      }

      const newChannel: NotificationEndpoint = {
        channelId,
        channel: channelType,
        name: channelName ?? `channel-${target.channels.length + 1}`,
        accountId,
        ...(threadId ? { threadId } : {}),
      };

      validateProjectRoute(ctx.runtime.config.current(), agentId, newChannel);
      validateDestinationAvailability(data, target.slug, newChannel);

      // Already linked to this project?
      const alreadyLinked = target.channels.some(
        (ch) => ch.channel === channelType
          && ch.accountId === accountId
          && ch.channelId === channelId
          && ch.threadId === threadId,
      );

      if (alreadyLinked) {
        return jsonResult({
          success: true,
          changed: false,
          project: target.name,
          projectSlug: target.slug,
          channelId,
          threadId,
          announcement: `Channel already linked to "${target.name}".`,
        });
      }

      target.channels.push(newChannel);

      await writeProjects(workspaceDir, data);

      await auditLog(workspaceDir, "channel_link", {
        project: target.name,
        projectSlug: target.slug,
        channelId,
        accountId,
        agentId,
        threadId,
        channelType,
        channelName: newChannel.name,
      });

      return jsonResult({
        success: true,
        changed: true,
        project: target.name,
        projectSlug: target.slug,
        channelId,
        threadId,
        channelName: newChannel.name,
        announcement: `Channel linked to "${target.name}".`,
      });
    },
  });
}
