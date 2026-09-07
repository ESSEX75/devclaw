/**
 * Exposes managed-issue repair to authorized project agents.
 * This adapter validates untrusted tool input and delegates repair semantics to the application layer.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import {
  isIssueRepairFailure,
  ISSUE_REPAIR_SOURCE,
  type IssueRepairSource,
  repairManagedIssue,
} from "../../application/issues/index.js";
import type { PluginContext } from "../../context.js";
import { readProjects } from "../../state/projects/index.js";
import { requireWorkspaceDir } from "../helpers.js";

const INPUT_FIELDS = new Set([
  "channelId", "project", "issueId", "source", "dryRun", "apply", "reason", "planToken",
]);

/** Create the safe-by-default issue_repair plugin tool. */
export function createIssueRepairTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issue_repair",
    label: "Issue Repair",
    description: "Plan or apply a verified repair between local managed issue state and provider projection.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["issueId", "source"],
      properties: {
        channelId: { type: "string", description: "Current bound chat/group ID; mutually exclusive with project." },
        project: { type: "string", description: "Explicit project slug; mutually exclusive with channelId." },
        issueId: { type: "number", description: "Positive provider issue ID." },
        source: { type: "string", enum: Object.values(ISSUE_REPAIR_SOURCE), description: "Authoritative repair source." },
        dryRun: { type: "boolean", description: "Plan without mutation; defaults to true." },
        apply: { type: "boolean", description: "Apply a previously planned repair." },
        planToken: { type: "string", description: "Token from the matching dry-run; required for apply." },
        reason: { type: "string", description: "Optional operator reason included in audit events." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      rejectUnknownFields(params);
      const projectInput = optionalString(params.project, "project");
      const channelId = optionalString(params.channelId, "channelId");

      if ((projectInput === undefined) === (channelId === undefined)) {
        throw new Error("Exactly one of project or channelId is required.");
      }

      const issueId = requirePositiveSafeInteger(params.issueId, "issueId");
      const source = requireRepairSource(params.source);
      const dryRun = optionalBoolean(params.dryRun, "dryRun");
      const apply = optionalBoolean(params.apply, "apply") ?? false;

      if (dryRun === true && apply) throw new Error("dryRun and apply cannot both be true.");
      if (dryRun === false && !apply) throw new Error("dryRun: false requires apply: true.");
      const planToken = optionalString(params.planToken, "planToken");

      if (apply && !planToken) throw new Error("planToken from a matching dry-run is required for apply.");
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const projects = await readProjects(workspaceDir);
      const matches = Object.values(projects.projects).filter((project) => (
        projectInput ? project.slug === projectInput : project.channels.some((endpoint) => endpoint.channelId === channelId)
      ));

      if (matches.length !== 1) throw new Error("Project selection must resolve to exactly one configured project.");
      const project = matches[0];

      if (!toolCtx.agentId || toolCtx.agentId !== project.agentId) {
        throw new Error(`Project "${project.slug}" belongs to agent "${project.agentId}".`);
      }

      let result;

      try {
        result = await repairManagedIssue({
          workspaceDir,
          projectSlug: project.slug,
          issueId,
          source,
          apply,
          planToken,
          reason: optionalString(params.reason, "reason"),
          actor: toolCtx.agentId,
          channelContext: { channelId },
          runCommand: ctx.runCommand,
        });
      } catch (error) {
        if (!isIssueRepairFailure(error)) throw error;

        return jsonResult({
          success: false,
          mode: apply ? "apply" : "dry_run",
          status: "blocked",
          project: project.slug,
          issueId,
          source,
          error: { code: error.code, message: error.message, retryable: error.retryable },
        });
      }

      return jsonResult(result);
    },
  });
}

function rejectUnknownFields(params: Record<string, unknown>): void {
  const unknown = Object.keys(params).filter((field) => !INPUT_FIELDS.has(field));

  if (unknown.length > 0) throw new Error(`Unknown issue_repair parameters: ${unknown.join(", ")}.`);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);

  return value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);

  return value;
}

function requirePositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }

  return value;
}

function requireRepairSource(value: unknown): IssueRepairSource {
  if (value === ISSUE_REPAIR_SOURCE.LOCAL_STATE || value === ISSUE_REPAIR_SOURCE.PROVIDER) return value;

  throw new Error("source must be local-state or provider.");
}
