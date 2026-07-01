/**
 * task_start — Advance an issue to the next queue in the workflow.
 *
 * The heartbeat is the sole dispatcher — this tool only places issues in
 * queues, never dispatches workers directly.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { startTask } from "../../application/tasks/start-task.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createTaskStartTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_start",
    label: "Task Start",
    description: `Advance an issue to the next queue in the workflow. State-agnostic: works from any state (Planning, Refining, To Do, etc.) and determines the correct queue automatically using workflow transitions.

Optionally set a level hint (e.g. "junior", "senior") so the heartbeat dispatches with the desired level. The heartbeat handles the actual dispatch — this tool only places issues in queues.

Examples:
- Start work: { channelId: "-1003844794417", issueId: 42 } → advances to next queue
- With level: { channelId: "-1003844794417", issueId: 42, level: "junior" } → advances + hints junior`,
    parameters: {
      type: "object",
      required: ["channelId", "issueId"],
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        issueId: {
          type: "number",
          description: "Issue ID to advance.",
        },
        level: {
          type: "string",
          description: "Optional level hint for dispatch (e.g. 'junior', 'senior'). Applied as a label so the heartbeat respects it.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);

      return jsonResult(await startTask({
        workspaceDir,
        channelId,
        issueId: params.issueId as number,
        level: params.level as string | undefined,
        runCommand: ctx.runCommand,
      }));
    },
  });
}
