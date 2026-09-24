/**
 * Migrates review and test policy snapshots on active issues.
 * Each apply holds the issue lock from local mutation through provider reconciliation.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { IssueRuntimeState, Project, ReviewPolicy, TestPolicy } from "../../domain/index.js";
import { createProvider, type IssueProvider } from "../../integrations/providers/index.js";
import { loadConfig, readIssueStateStore, readProjects, updateIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { type ManagedProjectionResult, reconcileManagedLabelsLocked } from "../projection/index.js";

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

type MigrationOptions = {
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
};

/** Apply a bounded policy selection to matching active issue states. */
export async function migrateIssuePolicies(opts: MigrationOptions): Promise<IssuePolicyMigrationResult> {
  if (!opts.reviewPolicy && !opts.testPolicy) throw new Error("Policy migration requires reviewPolicy and/or testPolicy.");
  const project = await requireProject(opts.workspaceDir, opts.projectSlug);
  const config = await loadConfig(opts.workspaceDir, project.slug);
  const snapshot = await readIssueStateStore(opts.workspaceDir, project.slug);
  const selectedIds = opts.issueIds ? new Set(opts.issueIds.map(String)) : null;
  const selectedStates = opts.workflowStates ? new Set(opts.workflowStates) : null;
  const changed: IssuePolicyMigrationChange[] = [];
  const skipped: Array<{ issueId: number; reason: string }> = [];
  let provider: IssueProvider | undefined = opts.provider;

  for (const [key, state] of Object.entries(snapshot.issues)) {
    if (selectedIds && !selectedIds.has(key)) continue;
    if (selectedStates && !selectedStates.has(state.workflowState)) continue;
    if (opts.dryRun) {
      const plan = planPolicyChange(state, opts);

      if (plan.reason) skipped.push({ issueId: state.issueId, reason: plan.reason });
      else if (plan.change) changed.push(plan.change);
      continue;
    }

    await withIssueOrchestrationLock(opts.workspaceDir, project.slug, state.issueId, async () => {
      const current = (await readIssueStateStore(opts.workspaceDir, project.slug)).issues[key];

      if (!current) {
        skipped.push({ issueId: state.issueId, reason: "not_found" });

        return;
      }

      if (selectedStates && !selectedStates.has(current.workflowState)) {
        skipped.push({ issueId: state.issueId, reason: "state_changed" });

        return;
      }

      const plan = planPolicyChange(current, opts);

      if (plan.reason && plan.reason !== "no_change") {
        skipped.push({ issueId: state.issueId, reason: plan.reason });

        return;
      }

      if (plan.change) {
        const change = plan.change;

        await updateIssueStateStore(opts.workspaceDir, project.slug, (store) => {
          const latest = store.issues[key];

          if (!latest) throw new Error(`Issue #${state.issueId} disappeared during policy migration.`);

          return {
            store: { ...store, issues: { ...store.issues, [key]: {
              ...latest,
              reviewPolicy: change.after.reviewPolicy,
              testPolicy: change.after.testPolicy,
              updatedAt: new Date().toISOString(),
            } } },
            result: undefined,
          };
        });
      }

      provider ??= (await createProvider({
        repo: project.repo,
        provider: project.provider,
        runCommand: opts.runCommand,
        workflow: config.workflow,
      })).provider;
      const projection = await reconcileManagedLabelsLocked({
        workspaceDir: opts.workspaceDir,
        projectSlug: project.slug,
        issueId: state.issueId,
        provider,
        workflow: config.workflow,
        roles: Object.keys(config.roles),
        owner: "issue_policy_migrate",
      });

      if (plan.change) changed.push({ ...plan.change, projection });
      else skipped.push({ issueId: state.issueId, reason: "no_change" });
    });
  }

  if (changed.length > 0) await auditLog(opts.workspaceDir, "issue_policy_migration", {
    project: opts.projectSlug,
    changed: changed.map((change) => ({ issueId: change.issueId, before: change.before, after: change.after })),
  });

  return { projectSlug: opts.projectSlug, dryRun: opts.dryRun === true, changed, skipped };
}

/** Calculate one issue's policy delta from a read-only snapshot. */
function planPolicyChange(state: IssueRuntimeState, opts: MigrationOptions): { reason?: string; change?: IssuePolicyMigrationChange } {
  if (state.activeWorker) return { reason: "active_worker" };
  if ((state.closedAt || state.workflowState === "done" || state.workflowState === "rejected") && !opts.includeClosed) {
    return { reason: "closed" };
  }

  const before = { reviewPolicy: state.reviewPolicy ?? null, testPolicy: state.testPolicy ?? null };
  const after = { reviewPolicy: opts.reviewPolicy ?? before.reviewPolicy, testPolicy: opts.testPolicy ?? before.testPolicy };

  if (before.reviewPolicy === after.reviewPolicy && before.testPolicy === after.testPolicy) return { reason: "no_change" };

  return { change: { issueId: state.issueId, before, after } };
}

/** Resolve the configured project for this administrative command. */
async function requireProject(workspaceDir: string, projectSlug: string): Promise<Project> {
  const projects = await readProjects(workspaceDir);
  const project = projects.projects[projectSlug];

  if (!project) throw new Error(`Project "${projectSlug}" not found.`);

  return project;
}
