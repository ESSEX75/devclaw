/**
 * sprint_repair — Explicit repair for sprint managed projection.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { loadConfig } from "../../config/index.js";
import { getProject, readProjects } from "../../projects/index.js";
import { createProvider } from "../../providers/index.js";
import { getSprintGraph, repairSprintProjectionFromLocalState } from "../../sprints/index.js";
import { requireWorkspaceDir } from "../helpers.js";

export type SprintRepairSource = "local-state" | "provider";

export function createSprintRepairTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "sprint_repair",
    label: "Sprint Repair",
    description: "Repair a sprint managed provider projection from local DevClaw state.",
    parameters: {
      type: "object",
      required: ["projectSlug", "sprintRootIssueId", "source"],
      properties: {
        projectSlug: {
          type: "string",
          description: "Registered project slug.",
        },
        sprintRootIssueId: {
          type: "number",
          description: "Sprint root issue id.",
        },
        source: {
          type: "string",
          enum: ["local-state", "provider"],
          description: "Repair source. local-state restores provider projection from sprints.json.",
        },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const result = await repairSprint({
        workspaceDir,
        ctx,
        projectSlug: requireString(params.projectSlug, "projectSlug"),
        sprintRootIssueId: requireIssueId(params.sprintRootIssueId),
        source: requireSource(params.source),
      });
      return jsonResult({ success: true, ...result });
    },
  });
}

export async function repairSprint(input: {
  workspaceDir: string;
  ctx: PluginContext;
  projectSlug: string;
  sprintRootIssueId: number;
  source: SprintRepairSource;
}): Promise<{ source: SprintRepairSource; repaired: string[] }> {
  if (input.source === "provider") {
    throw new Error("Repair from provider is not supported yet because provider projection is not authoritative.");
  }

  const projects = await readProjects(input.workspaceDir);
  const project = getProject(projects, input.projectSlug);
  if (!project || project.slug !== input.projectSlug) {
    throw new Error(`No project found for slug "${input.projectSlug}".`);
  }

  await loadConfig(input.workspaceDir, project.name);
  const graph = await getSprintGraph(input.workspaceDir, input.projectSlug, input.sprintRootIssueId);
  if (!graph) {
    throw new Error(`Sprint graph not found: ${input.projectSlug}:${input.sprintRootIssueId}`);
  }

  const { provider } = await createProvider({
    repo: project.repo,
    provider: project.provider,
    runCommand: input.ctx.runCommand,
  });
  const result = await repairSprintProjectionFromLocalState({
    workspaceDir: input.workspaceDir,
    provider,
    graph,
  });
  return { source: input.source, repaired: result.repaired };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requireIssueId(value: unknown): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("sprintRootIssueId must be a positive integer.");
  return id;
}

function requireSource(value: unknown): SprintRepairSource {
  if (value === "local-state" || value === "provider") return value;
  throw new Error("source must be local-state or provider.");
}
