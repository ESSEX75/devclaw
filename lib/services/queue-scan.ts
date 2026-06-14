/**
 * queue-scan.ts — Issue queue scanning helpers.
 *
 * Shared by: tick (projectTick), work-start (auto-pickup), and other consumers
 * that need to find queued issues or detect roles/levels from labels.
 */
import type { Issue, StateLabel } from "../providers/provider.js";
import type { IssueProvider } from "../providers/provider.js";
import { getLevelsForRole, getAllLevels } from "../roles/index.js";
import { listSprintGraphs, resolveStepReadiness, type SprintExecutionGraph } from "../sprints/index.js";
import {
  getQueueLabels,
  getAllQueueLabels,
  detectRoleFromLabel as workflowDetectRole,
  isOwnedByOrUnclaimed,
  type WorkflowConfig,
  type Role,
  TaskMode,
} from "../workflow/index.js";

// ---------------------------------------------------------------------------
// Label detection
// ---------------------------------------------------------------------------

export function detectLevelFromLabels(labels: string[]): string | null {
  const lower = labels.map((l) => l.toLowerCase());

  // Priority 1: Match role:level labels (e.g., "developer:senior", "developer:senior:Ada")
  for (const l of lower) {
    const parts = l.split(":");
    if (parts.length < 2) continue;
    const level = parts[1]!;
    const all = getAllLevels();
    if (all.includes(level)) return level;
  }

  // Priority 2: Match legacy role.level labels (e.g., "dev.senior", "qa.mid")
  for (const l of lower) {
    const dot = l.indexOf(".");
    if (dot === -1) continue;
    const role = l.slice(0, dot);
    const level = l.slice(dot + 1);
    const roleLevels = getLevelsForRole(role);
    if (roleLevels.includes(level)) return level;
  }

  // Fallback: plain level name
  const all = getAllLevels();
  return all.find((l) => lower.includes(l)) ?? null;
}

/**
 * Detect role, level, and optional slot name from colon-format labels.
 * Supports both 2-segment ("developer:senior") and 3-segment ("developer:senior:Ada") formats.
 * Returns the first match found, or null if no role:level label exists.
 */
export function detectRoleLevelFromLabels(
  labels: string[],
): { role: string; level: string; name?: string } | null {
  for (const label of labels) {
    const parts = label.split(":");
    if (parts.length < 2) continue;
    const role = parts[0]!.toLowerCase();
    const level = parts[1]!.toLowerCase();
    const roleLevels = getLevelsForRole(role);
    if (roleLevels.includes(level)) {
      return { role, level, name: parts[2] };
    }
  }
  return null;
}

/**
 * Detect step routing from labels (e.g. "review:human", "test:skip").
 * Returns the routing value for the given step, or null if no routing label exists.
 */
export function detectStepRouting(
  labels: string[], step: string,
): string | null {
  const prefix = `${step}:`;
  const match = labels.find((l) => l.toLowerCase().startsWith(prefix));
  return match ? match.slice(prefix.length).toLowerCase() : null;
}

/**
 * Detect role from a label using workflow config.
 */
export function detectRoleFromLabel(
  label: StateLabel,
  workflow: WorkflowConfig,
): Role | null {
  return workflowDetectRole(workflow, label);
}

// ---------------------------------------------------------------------------
// Issue queue queries
// ---------------------------------------------------------------------------

export async function findNextIssueForRole(
  provider: Pick<IssueProvider, "listIssuesByLabel">,
  role: Role,
  workflow: WorkflowConfig,
  instanceName?: string,
): Promise<{ issue: Issue; label: StateLabel } | null> {
  const labels = getQueueLabels(workflow, role);
  for (const label of labels) {
    try {
      const issues = await provider.listIssuesByLabel(label);
      const eligible = instanceName
        ? issues.filter((i) => isOwnedByOrUnclaimed(i.labels, instanceName))
        : issues;
      if (eligible.length > 0) return { issue: eligible[eligible.length - 1]!, label };
    } catch { /* continue */ }
  }
  return null;
}

export type QueueScanSkip = {
  issueId?: number;
  role?: Role;
  reason: string;
};

export type SprintDispatchGate = {
  workspaceDir: string;
  projectSlug: string;
};

export async function findNextDispatchableIssueForRole(
  provider: Pick<IssueProvider, "listIssuesByLabel">,
  role: Role,
  workflow: WorkflowConfig,
  opts?: {
    instanceName?: string;
    sprintGate?: SprintDispatchGate;
  },
): Promise<{ issue: Issue; label: StateLabel; skipped: QueueScanSkip[] } | null> {
  const candidates = await findDispatchableIssuesForRole(provider, role, workflow, opts);
  return candidates.matches[0] ?? null;
}

export async function findDispatchableIssuesForRole(
  provider: Pick<IssueProvider, "listIssuesByLabel">,
  role: Role,
  workflow: WorkflowConfig,
  opts?: {
    instanceName?: string;
    sprintGate?: SprintDispatchGate;
  },
): Promise<{
  matches: Array<{ issue: Issue; label: StateLabel; skipped: QueueScanSkip[] }>;
  skipped: QueueScanSkip[];
}> {
  const labels = getQueueLabels(workflow, role);
  const skipped: QueueScanSkip[] = [];
  const sprintGraphs = workflow.taskMode === TaskMode.SPRINT && opts?.sprintGate
    ? await listSprintGraphs(opts.sprintGate.workspaceDir, opts.sprintGate.projectSlug)
    : [];

  const matches: Array<{ issue: Issue; label: StateLabel; skipped: QueueScanSkip[] }> = [];
  for (const label of labels) {
    try {
      const issues = await provider.listIssuesByLabel(label);
      const eligible = opts?.instanceName
        ? issues.filter((i) => isOwnedByOrUnclaimed(i.labels, opts.instanceName!))
        : issues;

      for (let index = eligible.length - 1; index >= 0; index--) {
        const issue = eligible[index]!;
        const sprintDecision = getSprintDispatchDecision(sprintGraphs, issue);
        if (!sprintDecision.dispatchable) {
          skipped.push({ issueId: issue.iid, role, reason: sprintDecision.reason });
          continue;
        }
        matches.push({ issue, label, skipped });
      }
    } catch {
      // Continue scanning other labels. Provider errors are handled by callers.
    }
  }
  return { matches, skipped };
}

/**
 * Find next issue for any role (optional filter).
 */
export async function findNextIssue(
  provider: Pick<IssueProvider, "listIssuesByLabel">,
  role: Role | undefined,
  workflow: WorkflowConfig,
  instanceName?: string,
): Promise<{ issue: Issue; label: StateLabel } | null> {
  const labels = role
    ? getQueueLabels(workflow, role)
    : getAllQueueLabels(workflow);

  for (const label of labels) {
    try {
      const issues = await provider.listIssuesByLabel(label);
      const eligible = instanceName
        ? issues.filter((i) => isOwnedByOrUnclaimed(i.labels, instanceName))
        : issues;
      if (eligible.length > 0) return { issue: eligible[eligible.length - 1]!, label };
    } catch { /* continue */ }
  }
  return null;
}

function getSprintDispatchDecision(
  graphs: SprintExecutionGraph[],
  issue: Issue,
): { dispatchable: true } | { dispatchable: false; reason: string } {
  if (graphs.length === 0) return { dispatchable: true };

  for (const graph of graphs) {
    if (issue.iid === graph.sprintRootIssueId) {
      return { dispatchable: false, reason: "Sprint root is not dispatchable" };
    }

    const step = graph.steps.find((candidate) => candidate.issueId === issue.iid);
    if (!step) continue;

    const readiness = resolveStepReadiness(graph, issue.iid);
    if (readiness.ready) return { dispatchable: true };
    return {
      dispatchable: false,
      reason: `Sprint step not ready: ${readiness.reason}`,
    };
  }

  return { dispatchable: true };
}
