/**
 * tick.ts — Project-level queue scan + dispatch.
 *
/**
 * tick.ts — Project-level queue scan + dispatch.
 *
 * Core function: projectTick() scans one project's queue and fills free worker slots.
 * Called by: work_finish (next pipeline step), heartbeat service (sweep).
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import {
  countActiveSlots,
  EXECUTION_MODE,
  findFreeSlot,
  getActiveLabel,
  isBuiltInRoleId,
  reconcileSlots,
  REVIEW_POLICY,
  TEST_POLICY,
  type WorkflowConfig,
} from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import type { Issue, IssueProvider } from "../../integrations/providers/provider.js";
import { selectLevel } from "../../roles/model-selector.js";
import { getConfiguredRoleIds, loadConfig } from "../../state/config/index.js";
import type { ResolvedRoleConfig } from "../../state/config/types.js";
import { withIssueOrchestrationLock } from "../../state/issues/index.js";
import { getProject, getRoleWorker, readProjects } from "../../state/projects/index.js";
import { dispatchTask } from "../workers/dispatch-task.js";
import { detectRoleLevelFromLabels, findNextIssueForRole } from "./scan.js";

// ---------------------------------------------------------------------------
// projectTick
// ---------------------------------------------------------------------------

export type TickAction = {
  project: string;
  projectSlug: string;
  issueId: number;
  issueTitle: string;
  issueUrl: string;
  role: string;
  level: string;
  sessionAction: "spawn" | "send";
  announcement: string;
};

export type ProjectTickResult = {
  pickups: TickAction[];
  skipped: Array<{ role?: string; reason: string }>;
};

/**
 * Scan one project's queue and fill free worker slots.
 *
 * Does NOT run health checks (that's the heartbeat service's job).
 * Non-destructive: only dispatches if slots are free and issues are queued.
 */
export async function projectTick(opts: {
  workspaceDir: string;
  projectSlug: string;
  agentId?: string;
  sessionKey?: string;
  pluginConfig?: Record<string, unknown>;
  dryRun?: boolean;
  maxPickups?: number;
  /** Only attempt this role. Used by work_finish to fill the next pipeline step. */
  targetRole?: string;
  /** Optional provider override (for testing). Uses createProvider if omitted. */
  provider?: IssueProvider;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Instance name for ownership filtering and auto-claiming. */
  instanceName?: string;
  /** Injected runCommand for dependency injection. */
  runCommand?: RunCommand;
}): Promise<ProjectTickResult> {
  const {
    workspaceDir, projectSlug, agentId, sessionKey, pluginConfig, dryRun,
    maxPickups, targetRole, runtime, instanceName, runCommand,
  } = opts;

  const project = getProject(await readProjects(workspaceDir), projectSlug);

  if (!project) return { pickups: [], skipped: [{ reason: `Project not found: ${projectSlug}` }] };

  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const workflow = opts.workflow ?? resolvedConfig.workflow;

  const provider = opts.provider ?? (await createProvider({
    repo: project.repo,
    provider: project.provider,
    runCommand: runCommand!,
    workflow,
  })).provider;
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

    const levelMaxWorkers = resolvedConfig.roles[role]?.levelMaxWorkers ?? {};

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

          if (role === "reviewer") {
            const routing = lockedNext.localState.reviewPolicy;

            if (routing === "human" || routing === "skip") {
              return { action: null, reason: `review:${routing} policy` };
            }
          }

          if (role === "tester" && lockedNext.localState.testPolicy === "skip") {
            return { action: null, reason: "test:skip policy" };
          }

          const resolvedRole = resolvedConfig.roles[role];

          if (!resolvedRole) return { action: null, reason: "Role is not configured" };

          const selectedLevel = resolveLevelForIssue(
            lockedNext.issue,
            role,
            resolvedRole,
            resolvedConfig.roles,
            lockedNext.localState,
          );
          const freeSlot = findFreeSlot(lockedRoleWorker, selectedLevel);

          if (freeSlot === null) return { action: null, reason: `${selectedLevel} slots full` };

          if (dryRun) {
            const existingSession = lockedRoleWorker.levels[selectedLevel]?.[freeSlot]?.sessionKey;

            return {
              action: {
                project: project.name,
                projectSlug,
                issueId: lockedNext.issue.iid,
                issueTitle: lockedNext.issue.title,
                issueUrl: lockedNext.issue.web_url,
                role,
                level: selectedLevel,
                sessionAction: existingSession ? "send" : "spawn",
                announcement: `[DRY RUN] Would pick up #${lockedNext.issue.iid}`,
              },
            };
          }

          if (!runCommand) throw new Error("runCommand is required for queue dispatch.");

          const targetLabel = getActiveLabel(workflow, role);
          const dispatch = await dispatchTask({
            workspaceDir,
            agentId,
            project: lockedProject,
            issueId: lockedNext.issue.iid,
            issueTitle: lockedNext.issue.title,
            issueDescription: lockedNext.issue.description ?? "",
            issueUrl: lockedNext.issue.web_url,
            role,
            level: selectedLevel,
            fromLabel: lockedNext.label,
            toLabel: targetLabel,
            provider,
            pluginConfig,
            sessionKey,
            runtime,
            slotIndex: freeSlot,
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine the level for an issue based on labels and heuristic fallback.
 *
 * Priority:
 * 1. This role's own label (e.g. tester:medior from a previous dispatch)
 * 2. Inherit from another role's label (e.g. developer:medior → tester uses medior)
 * 3. Heuristic fallback (first dispatch, no labels yet)
 */
function resolveLevelForIssue(
  issue: Issue,
  role: string,
  resolvedRole: ResolvedRoleConfig,
  roles: Readonly<Record<string, ResolvedRoleConfig>>,
  localState?: { assignedRole?: string | null; assignedLevel?: string | null },
): string {
  if (localState?.assignedLevel) {
    if (localState.assignedRole === role) return localState.assignedLevel;
    const levels = resolvedRole.levels;

    if (levels.includes(localState.assignedLevel)) return localState.assignedLevel;
  }

  const roleLevel = detectRoleLevelFromLabels(issue.labels, roles);

  // Own role label
  if (roleLevel && roleLevel.role === role) return roleLevel.level;

  // Inherit from another role's label if level is valid for this role
  if (roleLevel) {
    const levels = resolvedRole.levels;

    if (levels.includes(roleLevel.level)) return roleLevel.level;
  }

  // Heuristic fallback
  return isBuiltInRoleId(role)
    ? selectLevel(issue.title, issue.description ?? "", role).level
    : resolvedRole.defaultLevel;
}
