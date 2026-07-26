/**
 * work_finish — Complete active worker work through the worker application use case.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { finishWork } from "../../application/workers/finish-work.js";
import type { PluginContext } from "../../context.js";
import { COMPLETION_RESULT } from "../../domain/index.js";
import { getAllRoleIds } from "../../roles/index.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createWorkFinishTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "work_finish",
    label: "Work Finish",
    description:
      `Complete a task: Developer done (PR created, goes to review) or blocked. ` +
      `Tester pass/fail/refine/blocked. Reviewer approve/reject/blocked. Architect done/blocked. ` +
      `Handles label transition, state update, issue close/reopen, notifications, and audit logging.`,
    parameters: {
      type: "object",
      required: ["channelId", "role", "result"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now " +
            "(e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        role: { type: "string", enum: getAllRoleIds(), description: "Worker role" },
        result: { type: "string", enum: Object.values(COMPLETION_RESULT), description: "Completion result" },
        summary: { type: "string", description: "Brief summary" },
        prUrl: { type: "string", description: "PR/MR URL (auto-detected if omitted)" },
        createdTasks: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "url"],
            properties: {
              id: { type: "number", description: "Issue ID" },
              title: { type: "string", description: "Issue title" },
              url: { type: "string", description: "Issue URL" },
            },
          },
          description: "Tasks created during this work session (architect creates implementation tasks).",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);

      return jsonResult(await finishWork({
        workspaceDir,
        channelId,
        role: params.role as string,
        result: params.result as string,
        summary: params.summary as string | undefined,
        prUrl: params.prUrl as string | undefined,
        createdTasks: params.createdTasks as Array<{ id: number; title: string; url: string }> | undefined,
        sessionKey: toolCtx.sessionKey,
        runCommand: ctx.runCommand,
        runtime: ctx.runtime,
        pluginConfig: ctx.pluginConfig,
      }));
    },
  });
}
