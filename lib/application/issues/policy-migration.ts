/**
 * Applies explicit review/test policy changes to existing local issue state.
 * This administrative use case updates local truth first and then reconciles provider labels.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { Project, ReviewPolicy, TestPolicy } from "../../domain/index.js";
import { createProvider, type IssueProvider } from "../../integrations/providers/index.js";
import { loadConfig } from "../../state/config/index.js";
import { updateIssueStateStore } from "../../state/issues/index.js";
import { readProjects } from "../../state/projects/index.js";
import { type ManagedProjectionResult,reconcileManagedLabels } from "../projection/index.js";

/** One policy mutation with its optional provider reconciliation result. */
export type IssuePolicyMigrationChange = {
  issueId: number;
  before: { reviewPolicy: ReviewPolicy | null; testPolicy: TestPolicy | null };
  after: { reviewPolicy: ReviewPolicy | null; testPolicy: TestPolicy | null };
  projection?: ManagedProjectionResult;
};

/** Summary returned by policy migration dry-run or apply. */
export type IssuePolicyMigrationResult = {
  projectSlug: string;
  dryRun: boolean;
  changed: IssuePolicyMigrationChange[];
  skipped: Array<{ issueId: number; reason: string }>;
};

/** Apply a bounded policy selection to matching active issue states. */
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
  runCommand: RunCommand;
}): Promise<IssuePolicyMigrationResult> {
  if (!opts.reviewPolicy && !opts.testPolicy) throw new Error("Policy migration requires reviewPolicy and/or testPolicy.");
  const project = await requireProject(opts.workspaceDir, opts.projectSlug);
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
        before: { reviewPolicy: currentReviewPolicy, testPolicy: currentTestPolicy },
        after: { reviewPolicy: nextReviewPolicy, testPolicy: nextTestPolicy },
      });
      if (!opts.dryRun) {
        state.reviewPolicy = nextReviewPolicy;
        state.testPolicy = nextTestPolicy;
        state.updatedAt = new Date().toISOString();
      }
    }
  });

  if (!opts.dryRun && changed.length > 0) {
    const provider = opts.provider ?? (await createProvider({
      repo: project.repo,
      provider: project.provider,
      runCommand: opts.runCommand,
      workflow: config.workflow,
    })).provider;

    for (const change of changed) {
      change.projection = await reconcileManagedLabels({
        workspaceDir: opts.workspaceDir,
        projectSlug: project.slug,
        issueId: change.issueId,
        provider,
        workflow: config.workflow,
        roles: Object.keys(config.roles),
        owner: "issue_policy_migrate",
      });
    }

    await auditLog(opts.workspaceDir, "issue_policy_migration", {
      project: opts.projectSlug,
      changed: changed.map((change) => ({ issueId: change.issueId, before: change.before, after: change.after })),
    });
  }

  return { projectSlug: opts.projectSlug, dryRun: opts.dryRun === true, changed, skipped };
}

async function requireProject(workspaceDir: string, projectSlug: string): Promise<Project> {
  const projects = await readProjects(workspaceDir);
  const project = projects.projects[projectSlug];

  if (!project) throw new Error(`Project "${projectSlug}" not found.`);

  return project;
}
