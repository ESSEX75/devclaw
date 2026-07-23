/**
 * tasks_status — Live issue counts and details from the issue tracker.
 *
 * Fetches all non-terminal issues grouped by state type (hold, active, queue).
 * Use `project_status` for instant local info, this tool for live issue data.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { getManagedTaskStatus } from "../../application/tasks/index.js";
import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import { loadConfig } from "../../state/config/index.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";

export function createTasksStatusTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "tasks_status",
    label: "Tasks Status",
    description:
      "Live issue dashboard from the issue tracker: issues waiting for input (hold), " +
      "work in progress (active), and queued for work (queue) — with issue details. " +
      "Use `project_status` for instant local info, `task_list` to filter/search issues.",
    parameters: {
      type: "object",
      required: ["channelId"],
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider } = await resolveProvider(project, ctx.runCommand);

      const projectConfig = await loadConfig(workspaceDir, project.name);
      const status = await getManagedTaskStatus({
        workspaceDir,
        projectSlug: project.slug,
        workflow: projectConfig.workflow,
        roles: Object.keys(projectConfig.roles),
        provider,
      });

      await auditLog(workspaceDir, "tasks_status", {
        project: project.name,
        totalHold: status.summary.totalHold,
        totalActive: status.summary.totalActive,
        totalQueued: status.summary.totalQueued,
      });

      return jsonResult({
        success: true,
        project: project.name,
        stateLabels: status.stateLabels,
        summary: status.summary,
        hold: status.hold,
        active: status.active,
        queue: status.queue,
      });
    },
  });
}
