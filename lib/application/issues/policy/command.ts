/**
 * Migrates review and test policy snapshots on active issues.
 * Each apply holds the issue lock from local mutation through provider reconciliation.
 */

import { log as auditLog } from "../../../audit.js";
import { type IssueRuntimeState, type Project, STATE_TYPE, type WorkflowConfig } from "../../../domain/index.js";
import { createProvider, type IssueProvider } from "../../../integrations/providers/index.js";
import { loadConfig, readIssueStateStore, readProjects, updateIssueStateStore, withIssueOrchestrationLock } from "../../../state/index.js";
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import { hasProjectWorkerSlot } from "../worker-slot.js";
import { POLICY_EVENT, POLICY_SKIP_REASON } from "./const.js";
import type { IssuePolicyMigrationChange, IssuePolicyMigrationResult, MigrationOptions, PolicyChangePlan } from "./types.js";

/** Apply a bounded policy selection to matching active issue states.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 */
export async function migrateIssuePolicies(opts: MigrationOptions): Promise<IssuePolicyMigrationResult> {
  if (!opts.reviewPolicy && !opts.testPolicy) throw new Error("Policy migration requires reviewPolicy and/or testPolicy.");
  const project = await requireProject(opts.workspaceDir, opts.projectSlug);
  const config = await loadConfig(opts.workspaceDir, project.slug);
  const snapshot = await readIssueStateStore(opts.workspaceDir, project.slug);
  const selectedIds = opts.issueIds ? new Set(opts.issueIds.map(String)) : null;
  const selectedStates = opts.workflowStates ? new Set(opts.workflowStates) : null;
  const changed: IssuePolicyMigrationChange[] = [];
  const skipped: IssuePolicyMigrationResult["skipped"] = [];
  let provider: IssueProvider | undefined = opts.provider;

  for (const [key, state] of Object.entries(snapshot.issues)) {
    if (selectedIds && !selectedIds.has(key)) continue;
    if (selectedStates && !selectedStates.has(state.workflowState)) continue;
    if (opts.dryRun) {
      const plan = planPolicyChange(state, opts, config.workflow, hasProjectWorkerSlot(project, state.issueId));

      if (plan.reason) skipped.push({ issueId: state.issueId, reason: plan.reason });
      else if (plan.change) changed.push(plan.change);
      continue;
    }

    await withIssueOrchestrationLock(opts.workspaceDir, project.slug, state.issueId, async () => {
      const current = (await readIssueStateStore(opts.workspaceDir, project.slug)).issues[key];

      if (!current) {
        skipped.push({ issueId: state.issueId, reason: POLICY_SKIP_REASON.NOT_FOUND });

        return;
      }

      if (selectedStates && !selectedStates.has(current.workflowState)) {
        skipped.push({ issueId: state.issueId, reason: POLICY_SKIP_REASON.STATE_CHANGED });

        return;
      }

      const currentProject = await requireProject(opts.workspaceDir, project.slug);
      const plan = planPolicyChange(current, opts, config.workflow, hasProjectWorkerSlot(currentProject, state.issueId));

      if (plan.reason && plan.reason !== POLICY_SKIP_REASON.NO_CHANGE) {
        skipped.push({ issueId: state.issueId, reason: plan.reason });

        return;
      }

      if (plan.change) {
        const change = plan.change;

        await updateIssueStateStore(opts.workspaceDir, project.slug, (store) => {
          const latest = store.issues[key];

          if (!latest) throw new Error(`Issue #${state.issueId} disappeared during policy migration.`);

          return {
            store: {
              ...store, issues: {
                ...store.issues, [key]: {
                  ...latest,
                  reviewPolicy: change.after.reviewPolicy,
                  testPolicy: change.after.testPolicy,
                  updatedAt: new Date().toISOString(),
                }
              }
            },
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
        owner: POLICY_EVENT.OWNER,
      });

      if (plan.change) changed.push({ ...plan.change, projection });
      else skipped.push({ issueId: state.issueId, reason: POLICY_SKIP_REASON.NO_CHANGE });
    });
  }

  if (changed.length > 0) await auditLog(opts.workspaceDir, POLICY_EVENT.MIGRATED, {
    project: opts.projectSlug,
    changed: changed.map((change) => ({ issueId: change.issueId, before: change.before, after: change.after })),
  });

  return { projectSlug: opts.projectSlug, dryRun: opts.dryRun === true, changed, skipped };
}

/** Calculate one issue's policy delta from a read-only snapshot.
 * @param state - Fresh authoritative runtime record used by this operation.
 * @param opts - Resolved project dependencies and the requested administrative operation.
 * @param workflow - Resolved project workflow including custom terminal states.
 * @param workerSlotOccupied - Whether the project registry reserves this issue under the same issue lock.
 */
function planPolicyChange(state: IssueRuntimeState, opts: MigrationOptions, workflow: WorkflowConfig, workerSlotOccupied: boolean): PolicyChangePlan {
  if (state.activeWorker || state.pendingWorkerRelease || workerSlotOccupied) return { reason: POLICY_SKIP_REASON.ACTIVE_WORKER };
  if ((state.closedAt || workflow.states[state.workflowState]?.type === STATE_TYPE.TERMINAL) && !opts.includeClosed) {
    return { reason: POLICY_SKIP_REASON.CLOSED };
  }

  const before = { reviewPolicy: state.reviewPolicy ?? null, testPolicy: state.testPolicy ?? null };
  const after = { reviewPolicy: opts.reviewPolicy ?? before.reviewPolicy, testPolicy: opts.testPolicy ?? before.testPolicy };

  if (before.reviewPolicy === after.reviewPolicy && before.testPolicy === after.testPolicy) return { reason: POLICY_SKIP_REASON.NO_CHANGE };

  return { change: { issueId: state.issueId, before, after } };
}

/** Resolve the configured project for this administrative command.
 * @param workspaceDir - Configured workspace containing authoritative project storage.
 * @param projectSlug - Canonical project identifier addressing local stores.
 */
async function requireProject(workspaceDir: string, projectSlug: string): Promise<Project> {
  const projects = await readProjects(workspaceDir);
  const project = projects.projects[projectSlug];

  if (!project) throw new Error(`Project "${projectSlug}" not found.`);

  return project;
}
