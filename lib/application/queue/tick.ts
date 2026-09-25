/**
 * tick.ts — Project-level queue scan + dispatch.
 *
 * Core function: projectTick() scans one project's queue and fills free worker slots.
 * Called by: work_finish (next pipeline step), heartbeat service (sweep).
 */
import {
  countActiveSlots,
  EXECUTION_MODE,
  getActiveLabel,
  reconcileSlots,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import { getConfiguredRoleIds, getLevelMaxWorkers, loadConfig } from "../../state/index.js";
import { withIssueOrchestrationLock } from "../../state/index.js";
import { getProject, getRoleWorker, readProjects } from "../../state/index.js";
import { dispatchTaskLocked } from "../workers/index.js";
import { planQueuePickup } from "./plan.js";
import { findNextIssueForRole } from "./scan.js";
import type { ProjectTickOptions, ProjectTickResult, TickAction } from "./types.js";

// ---------------------------------------------------------------------------
// projectTick
// ---------------------------------------------------------------------------

/**
 * Scan one project's queue and fill free worker slots.
 *
 * Does NOT run health checks (that's the heartbeat service's job).
 * Non-destructive: only dispatches if slots are free and issues are queued.
 */
export async function projectTick(opts: ProjectTickOptions): Promise<ProjectTickResult> {
  const {
    workspaceDir, projectSlug, agentId, sessionKey, pluginConfig, dryRun,
    maxPickups, targetRole, runtime, instanceName, runCommand,
  } = opts;

  const project = getProject(await readProjects(workspaceDir), projectSlug);

  if (!project) return { pickups: [], skipped: [{ reason: `Project not found: ${projectSlug}` }] };

  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const workflow = opts.workflow ?? resolvedConfig.workflow;

  let provider = opts.provider;

  if (!provider) {
    if (!runCommand) throw new Error("runCommand is required to create the queue provider.");
    provider = (await createProvider({ repo: project.repo, provider: project.provider, runCommand, workflow })).provider;
  }

  const roleExecution = workflow.roleExecution ?? EXECUTION_MODE.PARALLEL;
  const enabledRoles = getConfiguredRoleIds(resolvedConfig);
  const roles = targetRole ? [targetRole] : enabledRoles;

  const pickups: TickAction[] = [];
  const skipped: ProjectTickResult["skipped"] = [];
  let pickupCount = 0;

  for (const role of roles) {
    if (maxPickups !== undefined && pickupCount >= maxPickups) {
      skipped.push({ role, reason: "Max pickups reached" });
      continue;
    }

    // Re-read fresh state (previous dispatch may have changed it)
    const fresh = getProject(await readProjects(workspaceDir), projectSlug);

    if (!fresh) break;

    const levelMaxWorkers = getLevelMaxWorkers(resolvedConfig.roles[role]);

    // Check sequential role execution: any other role must be inactive
    const otherRoles = enabledRoles.filter((candidate) => candidate !== role);

    if (roleExecution === EXECUTION_MODE.SEQUENTIAL && otherRoles.some((candidate) => countActiveSlots(getRoleWorker(fresh, candidate)) > 0)) {
      skipped.push({ role, reason: "Sequential: other role active" });
      continue;
    }

    // Review policy gate: fallback for issues dispatched before step routing labels existed
    if (role === "reviewer") {
      const policy = workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN;

      if (policy === REVIEW_POLICY.HUMAN) {
        skipped.push({ role, reason: "Review policy: human (heartbeat handles via PR polling)" });
        continue;
      }

      if (policy === REVIEW_POLICY.SKIP) {
        skipped.push({ role, reason: "Review policy: skip (heartbeat handles via review-skip pass)" });
        continue;
      }
    }

    // Test policy gate: fallback for issues dispatched before test routing labels existed
    if (role === "tester") {
      const policy = workflow.testPolicy ?? TEST_POLICY.SKIP;

      if (policy === TEST_POLICY.SKIP) {
        skipped.push({ role, reason: "Test policy: skip (heartbeat handles via test-skip pass)" });
        continue;
      }
    }

    const next = await findNextIssueForRole(provider, role, workflow, instanceName, { workspaceDir, projectSlug });

    if (!next) continue;

    try {
      const claim = await withIssueOrchestrationLock(
        workspaceDir,
        projectSlug,
        next.issue.iid,
        async (): Promise<{ action: TickAction | null; reason?: string }> => {
          const lockedNext = await findNextIssueForRole(
            provider,
            role,
            workflow,
            instanceName,
            { workspaceDir, projectSlug },
          );

          if (!lockedNext || lockedNext.issue.iid !== next.issue.iid) {
            return { action: null, reason: `Issue #${next.issue.iid} is no longer the next ${role} candidate` };
          }

          const lockedProject = getProject(await readProjects(workspaceDir), projectSlug);

          if (!lockedProject) return { action: null, reason: `Project not found: ${projectSlug}` };

          const lockedRoleWorker = getRoleWorker(lockedProject, role);

          reconcileSlots(lockedRoleWorker, levelMaxWorkers);

          if (
            roleExecution === EXECUTION_MODE.SEQUENTIAL
            && otherRoles.some((candidate) => countActiveSlots(getRoleWorker(lockedProject, candidate)) > 0)
          ) {
            return { action: null, reason: "Sequential: other role active" };
          }

          const resolvedRole = resolvedConfig.roles[role];

          if (!resolvedRole) return { action: null, reason: "Role is not configured" };
          const pickup = planQueuePickup({
            issue: lockedNext.issue,
            localState: lockedNext.localState,
            role,
            roleConfig: resolvedRole,
            worker: lockedRoleWorker,
          });

          if (pickup.kind === "blocked") return { action: null, reason: pickup.reason };

          if (dryRun) {
            return {
              action: {
                project: project.name,
                projectSlug,
                issueId: lockedNext.issue.iid,
                issueTitle: lockedNext.issue.title,
                issueUrl: lockedNext.issue.web_url,
                role,
                level: pickup.level,
                sessionAction: pickup.sessionAction,
                announcement: `[DRY RUN] Would pick up #${lockedNext.issue.iid}`,
              },
            };
          }

          if (!runCommand) throw new Error("runCommand is required for queue dispatch.");

          const targetLabel = getActiveLabel(workflow, role);
          const dispatch = await dispatchTaskLocked({
            workspaceDir,
            agentId,
            project: lockedProject,
            issueId: lockedNext.issue.iid,
            issueTitle: lockedNext.issue.title,
            issueDescription: lockedNext.issue.description ?? "",
            issueUrl: lockedNext.issue.web_url,
            role,
            level: pickup.level,
            fromLabel: lockedNext.label,
            toLabel: targetLabel,
            provider,
            pluginConfig,
            sessionKey,
            runtime,
            slotIndex: pickup.slotIndex,
            instanceName,
            runCommand,
          });

          return {
            action: {
              project: project.name,
              projectSlug,
              issueId: lockedNext.issue.iid,
              issueTitle: lockedNext.issue.title,
              issueUrl: lockedNext.issue.web_url,
              role,
              level: dispatch.level,
              sessionAction: dispatch.sessionAction,
              announcement: dispatch.announcement,
            },
          };
        },
      );

      if (!claim.action) {
        skipped.push({ role, reason: claim.reason ?? "Issue claim changed" });
        continue;
      }

      pickups.push(claim.action);
      pickupCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      skipped.push({ role, reason: `Dispatch failed: ${message}` });
      continue;
    }
  }

  return { pickups, skipped };
}
