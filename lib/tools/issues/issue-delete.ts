/**
 * Exposes explicitly confirmed single-issue deletion to an agent conversation.
 * The adapter resolves the bound project and delegates every destructive decision to application code.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { deleteManagedIssue } from "../../application/issues/index.js";
import { validateProjectRoute } from "../../application/setup/index.js";
import type { PluginContext } from "../../context.js";
import { isNotificationChannel } from "../../domain/index.js";
import { readProjects } from "../../state/projects/index.js";
import { requireWorkspaceDir, resolveProvider } from "../helpers.js";

/** Create the capability-aware issue_delete tool. */
export function createIssueDeleteTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issue_delete",
    label: "Delete Issue",
    description: "Preview or explicitly confirm deletion of one provider issue and archive a local tombstone.",
    parameters: {
      type: "object",
      required: ["channel", "accountId", "channelId", "issueId"],
      properties: {
        channel: { type: "string", description: "Current OpenClaw channel type." },
        accountId: { type: "string", description: "Current explicit channel account ID." },
        channelId: { type: "string", description: "Current bound chat/group ID used to resolve the project." },
        threadId: { type: "string", description: "Current topic/thread ID when applicable." },
        issueId: { type: "number", description: "Provider issue number to delete." },
        confirmIssueId: { type: "number", description: "Must exactly match issueId when dryRun is false." },
        dryRun: { type: "boolean", description: "Preview only; defaults to true." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = requireString(params.channelId, "channelId");
      const accountId = requireString(params.accountId, "accountId");
      const channel = params.channel;

      if (!isNotificationChannel(channel)) throw new Error(`Unsupported notification channel "${String(channel)}".`);
      const threadId = params.threadId === undefined ? undefined : requireString(params.threadId, "threadId");
      const issueId = requirePositiveInteger(params.issueId, "issueId");
      const confirmIssueId = params.confirmIssueId === undefined
        ? undefined
        : requirePositiveInteger(params.confirmIssueId, "confirmIssueId");
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const projects = await readProjects(workspaceDir);
      const matches = Object.values(projects.projects).filter((candidate) => candidate.channels.some((endpoint) => (
        endpoint.channel === channel
        && endpoint.accountId === accountId
        && endpoint.channelId === channelId
        && endpoint.threadId === threadId
      )));

      if (matches.length !== 1) throw new Error(`Exact route ${channel}/${accountId}/${channelId}${threadId ? `/${threadId}` : ""} does not resolve to one project.`);
      const project = matches[0];
      const endpoint = project.channels.find((candidate) => (
        candidate.channel === channel
        && candidate.accountId === accountId
        && candidate.channelId === channelId
        && candidate.threadId === threadId
      ));

      if (!endpoint) throw new Error("Resolved project does not contain the exact route endpoint.");
      validateProjectRoute(ctx.runtime.config.current(), project.agentId, endpoint);

      if (toolCtx.agentId && toolCtx.agentId !== project.agentId) {
        throw new Error(`Project "${project.slug}" belongs to agent "${project.agentId}", not "${toolCtx.agentId}".`);
      }

      const { provider } = await resolveProvider(workspaceDir, project, ctx.runCommand);
      const result = await deleteManagedIssue({
        workspaceDir,
        projectSlug: project.slug,
        issueId,
        confirmIssueId,
        dryRun: params.dryRun !== false,
        provider,
        actor: toolCtx.agentId ?? "agent",
      });

      return jsonResult({ success: result.dryRun || (result.deleted && result.archived), ...result });
    },
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);

  return value.trim();
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer.`);

  return value;
}
