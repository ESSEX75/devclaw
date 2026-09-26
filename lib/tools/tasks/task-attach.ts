/**
 * task_attach — Attach files to issues or list existing attachments.
 *
 * Use cases:
 * - List attachments on an issue (for architects/developers)
 * - Manually attach a local file to an issue
 * - View attachment metadata and local paths
 */
import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";
import { z } from "zod";

import { manageTaskAttachments } from "../../application/tasks/index.js";
import type { PluginContext } from "../../context.js";
import { requireWorkspaceDir, resolveChannelId } from "../helpers.js";

/** Strict attachment command fields accepted at the tool boundary. */
const attachmentInput = z.object({ channelId: z.string().optional(), issueId: z.number().int().positive().safe(),
  action: z.enum(["list", "add", "get"]).default("list"), filePath: z.string().optional(), attachmentId: z.string().optional() });

/** Register manual attachment commands through application orchestration.
 * @param ctx - Provider transport and runtime diagnostics.
 */
export function createTaskAttachTool(ctx: PluginContext): OpenClawPluginToolFactory {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_attach",
    label: "Task Attach",
    description: `Manage file attachments on issues. List existing attachments or add new ones from local files.

Use cases:
- List attachments: { issueId: 42, action: "list" }
- Attach file: { issueId: 42, action: "add", filePath: "/path/to/file.png" }
- Get attachment path: { issueId: 42, action: "get", attachmentId: "abc-123" }`,
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
          description: "Issue ID",
        },
        action: {
          type: "string",
          enum: ["list", "add", "get"],
          description: "Action to perform. Defaults to 'list'.",
        },
        filePath: {
          type: "string",
          description: "Local file path to attach (required for 'add' action).",
        },
        attachmentId: {
          type: "string",
          description: "Attachment ID to retrieve (required for 'get' action).",
        },
      },
    },

    /** Validate the request and format the shared application result.
     * @param _id - SDK tool invocation identifier.
     * @param params - Untrusted tool arguments.
     */
    async execute(_id: string, params: Record<string, unknown>) {
      const input = attachmentInput.parse(params);

      return jsonResult(await manageTaskAttachments({ ...input,
        channelId: resolveChannelId(toolCtx, input.channelId), workspaceDir: requireWorkspaceDir(toolCtx), runCommand: ctx.runCommand }));
    },
  });
}
