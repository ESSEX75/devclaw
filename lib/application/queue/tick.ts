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
  EXECUTION_MODE,
  getActiveLabel,
  type LevelId,
  REVIEW_POLICY,
  type Role,
  TEST_POLICY,
  type WorkflowConfig,
} from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import type { Issue, IssueProvider } from "../../integrations/providers/provider.js";
import { getAllRoleIds, getLevelsForRole } from "../../roles/index.js";
import { selectLevel } from "../../roles/model-selector.js";
import { loadConfig } from "../../state/config/index.js";
import { countActiveSlots, findFreeSlot, getProject, getRoleWorker, readProjects, reconcileSlots } from "../../state/projects/index.js";
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
  role: Role;
  level: LevelId;
  sessionAction: "spawn" | "send";
  announcement: string;
};

export type TickResult = {
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
  targetRole?: Role;
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
}): Promise<TickResult> {
  const {
    workspaceDir, projectSlug, agentId, sessionKey, pluginConfig, dryRun,
    maxPickups, targetRole, runtime, instanceName, runCommand,
  } = opts;

  const project = getProject(await readProjects(workspaceDir), projectSlug);

  if (!project) return { pickups: [], skipped: [{ reason: `Project not found: ${projectSlug}` }] };

  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const workflow = opts.workflow ?? resolvedConfig.workflow;

  const provider = opts.provider ?? (await createProvider({ repo: project.repo, provider: project.provider, runCommand: runCommand! })).provider;
  const roleExecution = workflow.roleExecution ?? EXECUTION_MODE.PARALLEL;
  const enabledRoles = getAllRoleIds().filter((role) => resolvedConfig.roles[role]?.enabled);
  const roles: Role[] = targetRole ? [targetRole] : enabledRoles;

  const pickups: TickAction[] = [];
  const skipped: TickResult["skipped"] = [];
  let pickupCount = 0;

  for (const role of roles) {
    if (maxPickups !== undefined && pickupCount >= maxPickups) {
      skipped.push({ role, reason: "Max pickups reached" });
      continue;
    }

    // Re-read fresh state (previous dispatch may have changed it)
    const fresh = getProject(await readProjects(workspaceDir), projectSlug);

    if (!fresh) break;

    const roleWorker = getRoleWorker(fresh, role);
    const levelMaxWorkers = resolvedConfig.roles[role]?.levelMaxWorkers ?? {};

    reconcileSlots(roleWorker, levelMaxWorkers);

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

    const { issue, label: currentLabel } = next;
    const targetLabel = getActiveLabel(workflow, role);

    // Step routing comes from project-local issue state; provider labels are only projection.
    if (role === "reviewer") {
      const routing = next.localState?.reviewPolicy;

      if (routing === "human" || routing === "skip") {
        skipped.push({ role, reason: `review:${routing} policy` });
        continue;
      }
    }

    if (role === "tester") {
      const routing = next.localState?.testPolicy;

      if (routing === "skip") {
        skipped.push({ role, reason: "test:skip policy" });
        continue;
      }
    }

    // Level selection: label → heuristic (must happen before free slot check)
    const selectedLevel = resolveLevelForIssue(issue, role, next.localState);

    // Check per-level slot availability
    const freeSlot = findFreeSlot(roleWorker, selectedLevel);

    if (freeSlot === null) {
      skipped.push({ role, reason: `${selectedLevel} slots full` });
      continue;
    }

    if (dryRun) {
      const existingSession = roleWorker.levels[selectedLevel]?.[freeSlot]?.sessionKey;

      pickups.push({
        project: project.name, projectSlug, issueId: issue.iid, issueTitle: issue.title, issueUrl: issue.web_url,
        role, level: selectedLevel,
        sessionAction: existingSession ? "send" : "spawn",
        announcement: `[DRY RUN] Would pick up #${issue.iid}`,
      });
    } else {
      try {
        const dr = await dispatchTask({
          workspaceDir, agentId, project: fresh, issueId: issue.iid,
          issueTitle: issue.title, issueDescription: issue.description ?? "", issueUrl: issue.web_url,
          role, level: selectedLevel, fromLabel: currentLabel, toLabel: targetLabel,
          provider,
          pluginConfig,
          sessionKey,
          runtime,
          slotIndex: freeSlot,
          instanceName,
          runCommand: runCommand!,
        });

        pickups.push({
          project: project.name, projectSlug, issueId: issue.iid, issueTitle: issue.title, issueUrl: issue.web_url,
          role, level: dr.level, sessionAction: dr.sessionAction, announcement: dr.announcement,
        });
      } catch (err) {
        skipped.push({ role, reason: `Dispatch failed: ${(err as Error).message}` });
        continue;
      }
    }

    pickupCount++;
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
function resolveLevelForIssue(issue: Issue, role: Role, localState?: { assignedRole?: Role | null; assignedLevel?: LevelId | null }): LevelId {
  if (localState?.assignedLevel) {
    if (localState.assignedRole === role) return localState.assignedLevel;
    const levels = getLevelsForRole(role);

    if (levels.includes(localState.assignedLevel)) return localState.assignedLevel;
  }

  const roleLevel = detectRoleLevelFromLabels(issue.labels);

  // Own role label
  if (roleLevel?.role === role) return roleLevel.level;

  // Inherit from another role's label if level is valid for this role
  if (roleLevel) {
    const levels = getLevelsForRole(role);

    if (levels.includes(roleLevel.level)) return roleLevel.level;
  }

  // Heuristic fallback
  return selectLevel(issue.title, issue.description ?? "", role).level;
}
