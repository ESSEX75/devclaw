/**
 * task_list — Browse issues by workflow state.
 *
 * Lists issues grouped by state label with optional filtering by state type,
 * specific label, or text search. Supports terminal (closed) issues.
 */

import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";

import { ALL_TASK_STATES, listManagedTasks, resolveProject, resolveProvider } from "../../application/index.js";
import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import { STATE_TYPE } from "../../domain/index.js";
import { loadConfig } from "../../state/index.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createTaskListTool(ctx: PluginContext): OpenClawPluginToolFactory {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_list",
    label: "Task List",
    description:
      `Browse issues for a project by workflow state. Shows issues grouped by state label. ` +
      `Use \`tasks_status\` for a quick issue dashboard, this tool for filtered browsing.`,
    parameters: {
      type: "object",
      required: ["channelId"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now " +
            "(e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        stateType: {
          type: "string",
          enum: [...Object.values(STATE_TYPE), ALL_TASK_STATES],
          description: "Filter by state type. Defaults to all non-terminal states.",
        },
        label: {
          type: "string",
          description: "Filter by specific state label (e.g. 'Planning', 'Done'). Overrides stateType.",
        },
        search: {
          type: "string",
          description: "Text search in issue titles (case-insensitive).",
        },
        limit: {
          type: "integer",
          minimum: 0,
          description: "Max issues per state. Defaults to 20.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const requestedStateType = params.stateType;
      const stateType = requestedStateType === ALL_TASK_STATES
        ? ALL_TASK_STATES
        : Object.values(STATE_TYPE).find((state) => state === requestedStateType);

      if (requestedStateType !== undefined && stateType === undefined) {
        throw new Error(`Unknown state type "${String(requestedStateType)}".`);
      }

      const label = params.label as string | undefined;
      const search = params.search as string | undefined;
      const limit = (params.limit as number) ?? 20;

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider } = await resolveProvider(workspaceDir, project, ctx.runCommand);
      const projectConfig = await loadConfig(workspaceDir, project.slug);
      const result = await listManagedTasks({
        workspaceDir,
        projectSlug: project.slug,
        workflow: projectConfig.workflow,
        roles: Object.keys(projectConfig.roles),
        provider,
        stateType,
        label,
        search,
        limit,
      });

      await auditLog(workspaceDir, "task_list", {
        project: project.name,
        stateType: stateType ?? (label ? undefined : "non-terminal"),
        label,
        search,
        totalIssues: result.totalIssues,
      });

      return jsonResult({
        success: true,
        project: project.name,
        filter: result.filter,
        states: result.states,
        totalIssues: result.totalIssues,
      });
    },
  });
}
