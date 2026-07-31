/**
 * issue_repair — Restore provider projection from local issue state.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import type { IssueIntegrityStatus, Project, ReviewPolicy, TestPolicy, WorkflowConfig } from "../../domain/index.js";
import { getStateLabels, ISSUE_INTEGRITY_STATUS } from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import {
  diffIssueProjection,
  extractIssueMetadata,
  metadataMatches,
  type ProjectionDiff,
  replaceIssueMetadata,
} from "../../projection/index.js";
import { loadConfig } from "../../state/config/index.js";
import { readIssueStateStore, updateIssueStateStore } from "../../state/issues/index.js";
import { readProjects } from "../../state/projects/index.js";
import { requireWorkspaceDir } from "../helpers.js";

export type IssueRepairResult = {
  issueId: number;
  dryRun: boolean;
  diff: ProjectionDiff;
  metadataAction: "none" | "replace";
  integrityStatus: IssueIntegrityStatus;
  warnings: string[];
  repaired: string[];
};

export type IssuePolicyMigrationChange = {
  issueId: number;
  before: {
    reviewPolicy: ReviewPolicy | null;
    testPolicy: TestPolicy | null;
  };
  after: {
    reviewPolicy: ReviewPolicy | null;
    testPolicy: TestPolicy | null;
  };
  projection?: IssueRepairResult;
};

export type IssuePolicyMigrationResult = {
  projectSlug: string;
  dryRun: boolean;
  changed: IssuePolicyMigrationChange[];
  skipped: Array<{ issueId: number; reason: string }>;
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
      target.integrityStatus = ISSUE_INTEGRITY_STATUS.OK;
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
    integrityStatus: opts.dryRun ? state.integrityStatus : ISSUE_INTEGRITY_STATUS.OK,
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

export async function migrateIssuePolicies(opts: {
  workspaceDir: string;
  projectSlug: string;
  reviewPolicy?: ReviewPolicy;
  testPolicy?: TestPolicy;
  issueIds?: number[];
  workflowStates?: string[];
  includeClosed?: boolean;
  dryRun?: boolean;
  provider?: IssueProvider;
  runCommand: PluginContext["runCommand"];
}): Promise<IssuePolicyMigrationResult> {
  if (!opts.reviewPolicy && !opts.testPolicy) {
    throw new Error("Policy migration requires reviewPolicy and/or testPolicy.");
  }

  const projects = await readProjects(opts.workspaceDir);
  const project = projects.projects[opts.projectSlug];

  if (!project) throw new Error(`Project "${opts.projectSlug}" not found.`);

  const config = await loadConfig(opts.workspaceDir, project.name);
  const selectedIds = opts.issueIds ? new Set(opts.issueIds.map(String)) : null;
  const selectedStates = opts.workflowStates ? new Set(opts.workflowStates) : null;
  const changed: IssuePolicyMigrationChange[] = [];
  const skipped: Array<{ issueId: number; reason: string }> = [];

  await updateIssueStateStore(opts.workspaceDir, opts.projectSlug, (store) => {
    for (const [key, state] of Object.entries(store.issues)) {
      if (selectedIds && !selectedIds.has(key)) continue;
      if (selectedStates && !selectedStates.has(state.workflowState)) continue;

      if ((state.closedAt || state.workflowState === "done" || state.workflowState === "rejected") && !opts.includeClosed) {
        skipped.push({ issueId: state.issueId, reason: "closed" });
        continue;
      }

      const currentReviewPolicy = state.reviewPolicy ?? null;
      const currentTestPolicy = state.testPolicy ?? null;
      const nextReviewPolicy = opts.reviewPolicy ?? currentReviewPolicy;
      const nextTestPolicy = opts.testPolicy ?? currentTestPolicy;

      if (currentReviewPolicy === nextReviewPolicy && currentTestPolicy === nextTestPolicy) {
        skipped.push({ issueId: state.issueId, reason: "no_change" });
        continue;
      }

      changed.push({
        issueId: state.issueId,
        before: {
          reviewPolicy: currentReviewPolicy,
          testPolicy: currentTestPolicy,
        },
        after: {
          reviewPolicy: nextReviewPolicy,
          testPolicy: nextTestPolicy,
        },
      });

      if (!opts.dryRun) {
        state.reviewPolicy = nextReviewPolicy;
        state.testPolicy = nextTestPolicy;
        state.updatedAt = new Date().toISOString();
      }
    }
  });

  if (!opts.dryRun && changed.length > 0) {
    const provider = opts.provider ?? (await createProvider({ repo: project.repo, provider: project.provider, runCommand: opts.runCommand })).provider;

    for (const change of changed) {
      change.projection = await repairIssueProjection({
        workspaceDir: opts.workspaceDir,
        project,
        issueId: change.issueId,
        provider,
        workflow: config.workflow,
        roles: Object.keys(config.roles),
      });
    }

    await auditLog(opts.workspaceDir, "issue_policy_migration", {
      project: opts.projectSlug,
      changed: changed.map((change) => ({
        issueId: change.issueId,
        before: change.before,
        after: change.after,
      })),
    });
  }

  return {
    projectSlug: opts.projectSlug,
    dryRun: opts.dryRun === true,
    changed,
    skipped,
  };
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

export function createIssuePolicyMigrationTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issue_policy_migrate",
    label: "Issue Policy Migration",
    description: "Migrate review/test policy snapshots for existing managed issues from local state first, then provider projection.",
    parameters: {
      type: "object",
      required: ["project", "dryRun"],
      properties: {
        project: { type: "string", description: "Project slug." },
        reviewPolicy: { type: "string", enum: ["human", "agent", "skip"], description: "Optional review policy to set." },
        testPolicy: { type: "string", enum: ["agent", "skip"], description: "Optional test policy to set." },
        issueIds: { type: "array", items: { type: "number" }, description: "Optional issue IDs to migrate." },
        workflowStates: { type: "array", items: { type: "string" }, description: "Optional workflow state keys to filter." },
        includeClosed: { type: "boolean", description: "Include closed/done/rejected issues. Default false." },
        dryRun: { type: "boolean", description: "Show planned changes without writing." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const result = await migrateIssuePolicies({
        workspaceDir,
        projectSlug: params.project as string,
        reviewPolicy: params.reviewPolicy as ReviewPolicy | undefined,
        testPolicy: params.testPolicy as TestPolicy | undefined,
        issueIds: params.issueIds as number[] | undefined,
        workflowStates: params.workflowStates as string[] | undefined,
        includeClosed: params.includeClosed as boolean | undefined,
        dryRun: params.dryRun as boolean | undefined,
        runCommand: ctx.runCommand,
      });

      return jsonResult({ success: true, ...result });
    },
  });
}
