/**
 * Exposes explicit bulk review/test policy migration to an agent.
 * The adapter validates JSON input and delegates state and projection changes to application code.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { migrateIssuePolicies } from "../../application/issues/index.js";
import type { PluginContext } from "../../context.js";
import { isReviewPolicy, isTestPolicy, type ReviewPolicy, type TestPolicy } from "../../domain/index.js";
import { requireWorkspaceDir } from "../helpers.js";

/** Create the issue_policy_migrate administrative tool. */
export function createIssuePolicyMigrationTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issue_policy_migrate",
    label: "Issue Policy Migration",
    description: "Migrate review/test policy snapshots for existing active managed issues.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project", "dryRun"],
      properties: {
        project: { type: "string", description: "Project slug." },
        reviewPolicy: { type: "string", enum: ["human", "agent", "skip"], description: "Optional review policy." },
        testPolicy: { type: "string", enum: ["agent", "skip"], description: "Optional test policy." },
        issueIds: { type: "array", items: { type: "number" }, description: "Optional issue IDs." },
        workflowStates: { type: "array", items: { type: "string" }, description: "Optional state keys." },
        includeClosed: { type: "boolean", description: "Include terminal issue states." },
        dryRun: { type: "boolean", description: "Do not mutate local or provider state." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const result = await migrateIssuePolicies({
        workspaceDir: requireWorkspaceDir(toolCtx),
        projectSlug: requireString(params.project, "project"),
        reviewPolicy: optionalReviewPolicy(params.reviewPolicy),
        testPolicy: optionalTestPolicy(params.testPolicy),
        issueIds: optionalPositiveIntegerArray(params.issueIds, "issueIds"),
        workflowStates: optionalStringArray(params.workflowStates, "workflowStates"),
        includeClosed: optionalBoolean(params.includeClosed, "includeClosed"),
        dryRun: requireBoolean(params.dryRun, "dryRun"),
        runCommand: ctx.runCommand,
      });

      return jsonResult({ success: true, ...result });
    },
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);

  return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);

  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;

  return requireBoolean(value, field);
}

function optionalReviewPolicy(value: unknown): ReviewPolicy | undefined {
  if (value === undefined) return undefined;
  if (!isReviewPolicy(value)) throw new Error("reviewPolicy is invalid.");

  return value;
}

function optionalTestPolicy(value: unknown): TestPolicy | undefined {
  if (value === undefined) return undefined;
  if (!isTestPolicy(value)) throw new Error("testPolicy is invalid.");

  return value;
}

function optionalPositiveIntegerArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number" && Number.isSafeInteger(item) && item > 0)) {
    throw new Error(`${field} must contain positive safe integers.`);
  }

  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${field} must contain non-empty strings.`);
  }

  return value;
}
