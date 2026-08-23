/**
 * task_start — Advance an issue to the next queue in the workflow.
 *
 * The heartbeat is the sole dispatcher — this tool only places issues in
 * queues, never dispatches workers directly.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { startTask } from "../../application/tasks/start-task.js";
import type { PluginContext } from "../../context.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createTaskStartTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_start",
    label: "Task Start",
    description:
      `Advance a HOLD-state issue to its configured queue using the APPROVE transition.

Optionally assign a level (e.g. "junior", "senior"). Without one, a prepared level for the same role is reused or selected once before queueing.
The heartbeat handles the actual dispatch — this tool only places issues in queues.

Examples:
- Start work: { channelId: "-1003844794417", issueId: 42 } → advances to next queue
- With level: { channelId: "-1003844794417", issueId: 42, level: "junior" } → advances + hints junior`,
    parameters: {
      type: "object",
      required: ["channelId", "issueId"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now " +
            "(e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        issueId: {
          type: "number",
          description: "Issue ID to advance.",
        },
        level: {
          type: "string",
          description: "Optional level assignment (e.g. 'junior', 'senior'). Overrides a level prepared for the target role.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(
        toolCtx,
        typeof params.channelId === "string" ? params.channelId : undefined,
      );
      const issueId = params.issueId;
      const level = params.level;

      if (typeof issueId !== "number") throw new Error("'issueId' is required and must be a number.");
      if (level !== undefined && typeof level !== "string") throw new Error("'level' must be a string.");

      return jsonResult(await startTask({
        workspaceDir,
        channelId,
        issueId,
        level,
        runCommand: ctx.runCommand,
      }));
    },
  });
}
