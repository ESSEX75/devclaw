/**
 * queue-scan.ts — Issue queue scanning helpers.
 *
 * Shared by: tick (projectTick), work-start (auto-pickup), and other consumers
 * that need to find queued issues or detect roles/levels from labels.
 */
import type { Issue, StateLabel } from "../integrations/providers/provider.js";
import type { IssueProvider } from "../integrations/providers/provider.js";
import type { IssueReader } from "../integrations/providers/capabilities.js";
import { readIssueStateStore } from "../state/issues/index.js";
import type { IssueRuntimeState } from "../issues/types.js";
import { getLevelsForRole, getAllLevels } from "../roles/index.js";
import {
  getQueueLabels,
  detectRoleFromLabel as workflowDetectRole,
} from "../domain/workflow/queries.js";
import { isOwnedByOrUnclaimed } from "../domain/workflow/labels.js";
import type { WorkflowConfig, Role } from "../domain/workflow/types.js";

// ---------------------------------------------------------------------------
// Label detection
// ---------------------------------------------------------------------------

export function detectLevelFromLabels(labels: string[]): string | null {
  const lower = labels.map((l) => l.toLowerCase());

  // Match projected role:level labels (e.g., "developer:senior", "developer:senior:Ada").
  // Managed dispatch uses issues.json first; labels are only a compatibility fallback.
  for (const l of lower) {
    const parts = l.split(":");
    if (parts.length < 2) continue;
    const level = parts[1]!;
    const all = getAllLevels();
    if (all.includes(level)) return level;
  }

  return null;
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
  provider: Pick<IssueReader, "getIssue">,
  role: Role,
  workflow: WorkflowConfig,
  instanceName: string | undefined,
  localState: { workspaceDir: string; projectSlug: string },
): Promise<{ issue: Issue; label: StateLabel; localState: IssueRuntimeState } | null> {
  const labels = getQueueLabels(workflow, role);

  return findNextIssueForRoleFromLocalState(
    provider,
    labels,
    instanceName,
    localState.workspaceDir,
    localState.projectSlug,
  );
}

async function findNextIssueForRoleFromLocalState(
  provider: Pick<IssueReader, "getIssue">,
  queueLabels: StateLabel[],
  instanceName: string | undefined,
  workspaceDir: string,
  projectSlug: string,
): Promise<{ issue: Issue; label: StateLabel; localState: IssueRuntimeState } | null> {
  const store = await readIssueStateStore(workspaceDir, projectSlug);
  const localCandidates = Object.values(store.issues)
    .filter((state) =>
      state.managed
      && state.archivedAt == null
      && state.integrityStatus !== "integrity_error"
      && queueLabels.includes(state.workflowLabel),
    )
    .sort((a, b) => a.issueId - b.issueId);

  for (const state of localCandidates) {
    try {
      const issue = await provider.getIssue(state.issueId);
      if (issue.state === "closed" || issue.state === "CLOSED") continue;
      if (instanceName && !isOwnedByOrUnclaimed(issue.labels, instanceName)) continue;
      return { issue, label: state.workflowLabel, localState: state };
    } catch {
      continue;
    }
  }

  return null;
}
