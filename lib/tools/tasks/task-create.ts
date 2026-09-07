/**
 * task_create — Create a new task (issue) in the project's issue tracker.
 *
 * Atomically creates an issue with the specified title and description in the
 * configured initial workflow state.
 *
 * Use this when:
 * - You want to create work items from chat
 * - A sub-agent finds a bug and needs to file a follow-up issue
 * - Breaking down an epic into smaller tasks
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { createManagedTaskIssue } from "../../application/tasks/index.js";
import type { PluginContext } from "../../context.js";
import type { NotifyBindingRef } from "../../domain/index.js";
import { loadInstanceName } from "../../instance.js";
import { loadConfig } from "../../state/config/index.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";

export function createTaskCreateTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_create",
    label: "Task Create",
    description:
      "Create a new task (issue) in the project's issue tracker. Use this to file bugs, features, or tasks from chat. " +
      "The issue remains in the configured initial state until task_start is called, unless that initial state is already a queue.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["channelId", "title", "idempotencyKey"],
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
        idempotencyKey: {
          type: "string",
          description: "Stable caller-generated request ID. Reuse it only when retrying this exact creation request.",
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
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(toolCtx, optionalString(params.channelId, "channelId"));
      const title = requiredString(params.title, "title");
      const description = optionalString(params.description, "description") ?? "";
      const assignees = optionalStringArray(params.assignees, "assignees");
      const idempotencyKey = requiredString(params.idempotencyKey, "idempotencyKey");
      const workspaceDir = requireWorkspaceDir(toolCtx);

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider, type: providerType } = await resolveProvider(workspaceDir, project, ctx.runCommand);
      const resolvedConfig = await loadConfig(workspaceDir, project.name);
      const instanceName = await loadInstanceName(workspaceDir, resolvedConfig.instanceName);
      const sourceChannel = project.channels.find((ch) => ch.channelId === channelId) ?? project.channels[0];
      const notifyTarget: NotifyBindingRef | null = sourceChannel
        ? { channel: sourceChannel.channel, name: sourceChannel.name }
        : null;

      const created = await createManagedTaskIssue({
        workspaceDir,
        project,
        providerType,
        provider,
        workflow: resolvedConfig.workflow,
        roles: Object.keys(resolvedConfig.roles),
        title,
        description,
        assignees,
        notifyTarget,
        owner: instanceName,
        idempotencyKey,
        requestedBy: toolCtx.agentId ?? "agent",
      });

      if (created.success && created.issue) provider.reactToIssue(created.issue.iid, "eyes").catch(() => {});

      const hasBody = description && description.trim().length > 0;
      let announcement = created.issue
        ? `${created.success ? "📋 Created" : "⏳ Creation pending for"} #${created.issue.iid}: "${title}" (${created.label})`
        : `⏳ Creation pending: "${title}" (${created.label})`;

      if (hasBody) announcement += "\nWith detailed description.";
      if (created.issue) announcement += `\n🔗 [Issue #${created.issue.iid}](${created.issue.web_url})`;
      announcement += created.announcementSuffix;

      return jsonResult({
        success: created.success,
        status: created.status,
        operationId: created.operationId,
        idempotencyKey: created.idempotencyKey,
        issue: created.issue ? {
          id: created.issue.iid,
          title: created.issue.title,
          body: hasBody ? description : null,
          url: created.issue.web_url,
          label: created.label,
          workflowState: created.workflowState,
          role: created.role,
        } : undefined,
        project: project.name,
        provider: providerType,
        completedSteps: created.completedSteps,
        pendingSteps: created.pendingSteps,
        integrity: created.integrity,
        error: created.error,
        recovery: created.recovery,
        auditCorrelationId: created.auditCorrelationId,
        announcement,
      });
    },
  });
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);

  if (!parsed) throw new Error(`'${field}' is required.`);

  return parsed;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`'${field}' must be a string.`);

  return value;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!isStringArray(value)) {
    throw new Error(`'${field}' must be an array of strings.`);
  }

  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
