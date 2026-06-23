/**
 * issue_repair — Restore provider projection from local issue state.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { log as auditLog } from "../../audit.js";
import { loadConfig } from "../../config/index.js";
import { readIssueStateStore, updateIssueStateStore } from "../../issues/index.js";
import { readProjects } from "../../projects/index.js";
import { createProvider } from "../../providers/index.js";
import type { IssueProvider } from "../../providers/provider.js";
import {
  diffIssueProjection,
  extractIssueMetadata,
  replaceIssueMetadata,
  metadataMatches,
  type ProjectionDiff,
} from "../../projection/index.js";
import { getStateLabels } from "../../workflow/index.js";
import { requireWorkspaceDir } from "../helpers.js";
import type { Project } from "../../projects/index.js";
import type { WorkflowConfig } from "../../workflow/index.js";

export type IssueRepairResult = {
  issueId: number;
  dryRun: boolean;
  diff: ProjectionDiff;
  metadataAction: "none" | "replace";
  integrityStatus: string;
  warnings: string[];
  repaired: string[];
};

export async function repairIssueProjection(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug">;
  issueId: number;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  roles: string[];
  dryRun?: boolean;
}): Promise<IssueRepairResult> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.project.slug);
  const state = store.issues[String(opts.issueId)];
  if (!state) throw new Error(`Issue #${opts.issueId} has no local issue state.`);

  const issue = await opts.provider.getIssue(opts.issueId);
  const diff = diffIssueProjection({
    state,
    actualLabels: issue.labels,
    options: {
      stateLabels: getStateLabels(opts.workflow),
      roles: opts.roles,
    },
  });

  const expectedMetadata = {
    projectSlug: state.projectSlug,
    issueId: state.issueId,
    projectionVersion: state.projectionVersion,
  };
  const currentMetadata = extractIssueMetadata(issue.description);
  const metadataAction = metadataMatches(currentMetadata, expectedMetadata) ? "none" : "replace";

  const repaired: string[] = [];
  if (!opts.dryRun) {
    for (const label of diff.missingManagedLabels) {
      await opts.provider.addLabel(opts.issueId, label);
      repaired.push(`add-label:${label}`);
    }
    if (diff.unexpectedManagedLabels.length > 0) {
      await opts.provider.removeLabels(opts.issueId, diff.unexpectedManagedLabels);
      repaired.push(...diff.unexpectedManagedLabels.map((label) => `remove-label:${label}`));
    }
    if (metadataAction === "replace") {
      await opts.provider.editIssue(opts.issueId, {
        body: replaceIssueMetadata(issue.description, expectedMetadata),
      });
      repaired.push("metadata");
    }
    await updateIssueStateStore(opts.workspaceDir, opts.project.slug, (data) => {
      const target = data.issues[String(opts.issueId)];
      if (!target) return;
      target.integrityStatus = "ok";
      target.integrityErrors = [];
      target.updatedAt = new Date().toISOString();
    });
    await auditLog(opts.workspaceDir, "issue_projection_repair", {
      project: opts.project.slug,
      issueId: opts.issueId,
      repaired,
    });
  }

  return {
    issueId: opts.issueId,
    dryRun: opts.dryRun === true,
    diff,
    metadataAction,
    integrityStatus: opts.dryRun ? state.integrityStatus : "ok",
    warnings: [],
    repaired,
  };
}

export async function repairIssueFromLocalState(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  source: string;
  dryRun?: boolean;
  provider?: IssueProvider;
  runCommand: PluginContext["runCommand"];
}): Promise<IssueRepairResult> {
  if (opts.source !== "local-state") {
    throw new Error("Repair from provider is not supported because provider projection is not authoritative.");
  }

  const projects = await readProjects(opts.workspaceDir);
  const project = projects.projects[opts.projectSlug];
  if (!project) throw new Error(`Project "${opts.projectSlug}" not found.`);

  const config = await loadConfig(opts.workspaceDir, project.name);
  const provider = opts.provider ?? (await createProvider({ repo: project.repo, provider: project.provider, runCommand: opts.runCommand })).provider;
  return repairIssueProjection({
    workspaceDir: opts.workspaceDir,
    project,
    issueId: opts.issueId,
    provider,
    workflow: config.workflow,
    roles: Object.keys(config.roles),
    dryRun: opts.dryRun,
  });
}

export function createIssueRepairTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issue_repair",
    label: "Issue Repair",
    description: "Restore provider labels and managed metadata from project-local issues.json.",
    parameters: {
      type: "object",
      required: ["project", "issueId", "source", "dryRun"],
      properties: {
        project: { type: "string", description: "Project slug." },
        issueId: { type: "number", description: "Issue ID to repair." },
        source: { type: "string", enum: ["local-state", "provider"], description: "Repair source. Only local-state is supported." },
        dryRun: { type: "boolean", description: "Show planned changes without writing." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const result = await repairIssueFromLocalState({
        workspaceDir,
        projectSlug: params.project as string,
        issueId: params.issueId as number,
        source: params.source as string,
        dryRun: params.dryRun as boolean | undefined,
        runCommand: ctx.runCommand,
      });
      return jsonResult({ success: true, ...result });
    },
  });
}
