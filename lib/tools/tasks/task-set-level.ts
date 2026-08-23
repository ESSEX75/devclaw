/**
 * task_set_level — Set the developer level hint on a HOLD-state issue.
 *
 * Restricted to HOLD states only (Planning, Refining). The assignment is
 * stored locally for the target queue role and projected as a provider label.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { setTaskLevel } from "../../application/tasks/index.js";
import type { PluginContext } from "../../context.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createTaskSetLevelTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_set_level",
    label: "Task Set Level",
    description:
      `Set the target role level on a HOLD-state issue (Planning, Refining). ` +
      `The assignment is saved in local issue state and used when task_start advances the issue.

Examples:
- { issueId: 42, level: "senior" }
- { issueId: 42, level: "junior", reason: "Simple typo fix" }`,
    parameters: {
      type: "object",
      required: ["channelId", "issueId", "level"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now " +
            "(e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        issueId: {
          type: "number",
          description: "Issue ID to update",
        },
        level: {
          type: "string",
          description: "Override the role:level hint (e.g., 'senior', 'junior'). Applied so the heartbeat dispatches with this level when the issue is advanced via task_start.",
        },
        reason: {
          type: "string",
          description: "Optional audit log reason for the change",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(
        toolCtx,
        typeof params.channelId === "string" ? params.channelId : undefined,
      );
      const issueId = params.issueId;
      const newLevel = params.level;
      const reason = typeof params.reason === "string" ? params.reason : undefined;
      const workspaceDir = requireWorkspaceDir(toolCtx);

      if (typeof issueId !== "number") {
        throw new Error("'issueId' is required and must be a number.");
      }

      if (typeof newLevel !== "string") {
        throw new Error("'level' is required.");
      }

      return jsonResult(await setTaskLevel({
        workspaceDir,
        channelId,
        issueId,
        level: newLevel,
        ...(reason ? { reason } : {}),
        runCommand: ctx.runCommand,
      }));
    },
  });
}
