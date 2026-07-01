/**
 * task_edit_body — Update issue title and/or description through the task
 * application use case.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { editTaskBody } from "../../application/tasks/edit-task-body.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

export function createTaskEditBodyTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_edit_body",
    label: "Task Edit Body",
    description: `Update issue title and/or description. Only allowed in the initial workflow state (e.g. "Planning") — prevents editing in-progress work.

Logs the edit to the audit trail with timestamp, caller, and a diff summary.
Optionally posts an auto-comment on the issue for traceability.

Examples:
- Fix typo: { issueId: 42, title: "Fix login timeout bug" }
- Clarify scope: { issueId: 42, body: "Updated requirements...", reason: "Clarified after meeting" }
- Silent edit: { issueId: 42, body: "...", addComment: false }`,
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
          description: "Issue ID to edit",
        },
        title: {
          type: "string",
          description: "New title for the issue (optional)",
        },
        body: {
          type: "string",
          description: "New body/description for the issue (optional)",
        },
        reason: {
          type: "string",
          description: "Why the edit was made (optional, for audit trail)",
        },
        addComment: {
          type: "boolean",
          description: "Post an auto-comment on the issue noting the edit (default: true)",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);

      return jsonResult(await editTaskBody({
        workspaceDir,
        channelId,
        issueId: params.issueId as number,
        title: params.title as string | undefined,
        body: params.body as string | undefined,
        reason: params.reason as string | undefined,
        addComment: params.addComment as boolean | undefined,
        runCommand: ctx.runCommand,
      }));
    },
  });
}
