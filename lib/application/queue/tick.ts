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
} from "../../domain/index.js";
import { createProvider,isProviderIssueLookupError } from "../../integrations/providers/index.js";
import { getConfiguredRoleIds, getLevelMaxWorkers, loadConfig } from "../../state/index.js";
import { withIssueOrchestrationLock } from "../../state/index.js";
import { getProject, getRoleWorker, readProjects } from "../../state/index.js";
import { dispatchTaskLocked } from "../workers/index.js";
import { QUEUE_PLAN, QUEUE_REASON } from "./const.js";
import { planQueuePickup } from "./plan.js";
import { findNextIssueForRole } from "./scan.js";
import type { ProjectTickOptions, ProjectTickResult, QueueClaim, TickAction } from "./types.js";

/**
 * Scan one project's queue and fill free worker slots.
 *
 * Does NOT run health checks (that's the heartbeat service's job).
 * Reservations recheck project constraints atomically before provider or gateway effects.
 * @param opts - Project, resolved dependencies, and pickup bounds.
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
    provider = (await createProvider({ repo: project.repo, provider: project.provider, runCommand })).provider;
  }

  const roleExecution = workflow.roleExecution ?? EXECUTION_MODE.PARALLEL;
  const enabledRoles = getConfiguredRoleIds(resolvedConfig);
  const roles = targetRole ? [targetRole] : enabledRoles;

  const pickups: TickAction[] = [];
  const skipped: ProjectTickResult["skipped"] = [];
  let pickupCount = 0;

  for (const role of roles) {
    if (!enabledRoles.includes(role)) {
      skipped.push({ role, code: QUEUE_REASON.ROLE_UNAVAILABLE, reason: "Role is not configured or is disabled" });
      continue;
    }

    if (maxPickups !== undefined && pickupCount >= maxPickups) {
      skipped.push({ role, code: QUEUE_REASON.PICKUP_LIMIT, reason: "Max pickups reached" });
      continue;
    }

    // Re-read fresh state (previous dispatch may have changed it)
    const fresh = getProject(await readProjects(workspaceDir), projectSlug);

    if (!fresh) break;

    const levelMaxWorkers = getLevelMaxWorkers(resolvedConfig.roles[role]);

    // Check sequential role execution: any other role must be inactive
    const otherRoles = Object.keys(fresh.workers).filter((candidate) => candidate !== role);

    if (roleExecution === EXECUTION_MODE.SEQUENTIAL && otherRoles.some((candidate) => countActiveSlots(getRoleWorker(fresh, candidate)) > 0)) {
      skipped.push({ role, code: QUEUE_REASON.SEQUENTIAL, reason: "Sequential: other role active" });
      continue;
    }

    try {
      const next = await findNextIssueForRole(provider, role, workflow, instanceName, { workspaceDir, projectSlug });

      if (!next) continue;

      const claim = await withIssueOrchestrationLock(
        workspaceDir,
        projectSlug,
        next.issue.iid,
        async (): Promise<QueueClaim> => {
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
            && Object.entries(lockedProject.workers).some(([candidate, worker]) => candidate !== role && countActiveSlots(worker) > 0)
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

          if (pickup.kind === QUEUE_PLAN.BLOCKED) return { action: null, code: pickup.code, reason: pickup.reason };

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
            roleExecution,
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
        skipped.push({ role, code: claim.code, reason: claim.reason ?? "Issue claim changed" });
        continue;
      }

      pickups.push(claim.action);
      pickupCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      skipped.push({
        role, code: isProviderIssueLookupError(error) ? error.code : QUEUE_REASON.DISPATCH_FAILED,
        reason: `Queue ${role} failed: ${message}`
      });
      continue;
    }
  }

  return { pickups, skipped };
}
