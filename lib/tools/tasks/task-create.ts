/**
 * task_create — Create a new task (issue) in the project's issue tracker.
 *
 * Atomically: creates an issue with the specified title and description in the
 * initial workflow state. Returns the created issue for immediate pickup if desired.
 *
 * Use this when:
 * - You want to create work items from chat
 * - A sub-agent finds a bug and needs to file a follow-up issue
 * - Breaking down an epic into smaller tasks
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { createManagedTaskIssue } from "../../application/tasks/index.js";
import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import type { NotifyTarget } from "../../domain/index.js";
import { loadInstanceName } from "../../instance.js";
import { loadConfig } from "../../state/config/index.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";

export function createTaskCreateTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_create",
    label: "Task Create",
    description:
      "Create a new task (issue) in the project's issue tracker. Use this to file bugs, features, or tasks from chat. " +
      "Issues are queued immediately in the workflow's first developer queue for heartbeat dispatch.",
    parameters: {
      type: "object",
      required: ["channelId", "title"],
      properties: {
        channelId: {
          type: "string",
          description:
            "YOUR chat/group ID — the numeric ID of the chat you are in right now " +
            "(e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        title: {
          type: "string",
          description: "Short, descriptive issue title (e.g., 'Fix login timeout bug')",
        },
        description: {
          type: "string",
          description: "Full issue body in markdown. Use for detailed context, acceptance criteria, reproduction steps, links. Supports GitHub-flavored markdown.",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "GitHub/GitLab usernames to assign (optional)",
        },
        pickup: {
          type: "boolean",
          description: "If true, immediately pick up this issue for DEV after creation. Defaults to false.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const title = params.title as string;
      const description = (params.description as string) ?? "";
      const assignees = (params.assignees as string[] | undefined) ?? [];
      const pickup = (params.pickup as boolean) ?? false;
      const workspaceDir = requireWorkspaceDir(toolCtx);

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider, type: providerType } = await resolveProvider(project, ctx.runCommand);
      const resolvedConfig = await loadConfig(workspaceDir, project.name);
      const instanceName = await loadInstanceName(workspaceDir, resolvedConfig.instanceName);
      const sourceChannel = project.channels.find((ch) => ch.channelId === channelId) ?? project.channels[0];
      const notifyTarget: NotifyTarget | null = sourceChannel
        ? { channel: sourceChannel.channel, name: sourceChannel.name }
        : null;

      const created = await createManagedTaskIssue({
        workspaceDir,
        project,
        providerType,
        provider,
        workflow: resolvedConfig.workflow,
        title,
        description,
        assignees,
        notifyTarget,
        owner: instanceName,
      });

      // Mark as system-managed (best-effort).
      provider.reactToIssue(created.issue.iid, "eyes").catch(() => {});

      await auditLog(workspaceDir, "task_create", {
        project: project.name, issueId: created.issue.iid,
        title, label: created.label, provider: providerType, pickup,
      });

      const hasBody = description && description.trim().length > 0;
      let announcement = `📋 Created #${created.issue.iid}: "${title}" (${created.label})`;

      if (hasBody) announcement += "\nWith detailed description.";
      announcement += `\n🔗 [Issue #${created.issue.iid}](${created.issue.web_url})`;
      announcement += created.announcementSuffix;

      return jsonResult({
        success: true,
        issue: {
          id: created.issue.iid,
          title: created.issue.title,
          body: hasBody ? description : null,
          url: created.issue.web_url,
          label: created.label,
          workflowState: created.workflowState,
          role: created.role,
        },
        project: project.name, provider: providerType, pickup, announcement,
      });
    },
  });
}
