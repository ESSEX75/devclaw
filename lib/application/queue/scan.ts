/**
 * queue-scan.ts — Issue queue scanning helpers.
 *
 * Shared by: tick (projectTick), work-start (auto-pickup), and other consumers
 * that need to find queued issues or detect roles/levels from labels.
 */
import type { IssueRuntimeState } from "../../domain/index.js";
import type { WorkflowConfig } from "../../domain/index.js";
import { isLevelId, ISSUE_INTEGRITY_STATUS, type LevelId, type RoleId } from "../../domain/index.js";
import { isOwnedByOrUnclaimed } from "../../domain/index.js";
import {
  detectRoleFromLabel,
  getQueueLabels,
} from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import type { Issue, StateLabel } from "../../integrations/providers/provider.js";
import { getAllLevels, getLevelsForRole, isValidRole } from "../../roles/index.js";
import { readIssueStateStore } from "../../state/issues/index.js";

// ---------------------------------------------------------------------------
// Label detection
// ---------------------------------------------------------------------------

export function detectLevelFromLabels(labels: string[]): LevelId | null {
  const lower = labels.map((l) => l.toLowerCase());

  // Match projected role:level labels (e.g., "developer:senior").
  // Managed dispatch uses issues.json first; labels are only a compatibility fallback.
  for (const l of lower) {
    const parts = l.split(":");

    if (parts.length !== 2) continue;
    const level = parts[1]!;
    const all = getAllLevels();

    if (isLevelId(level) && all.includes(level)) return level;
  }

  return null;
}

/**
 * Detect role and level from normalized colon-format labels.
 * Supports only 2-segment labels ("developer:senior"). Worker identity lives in
 * local runtime state, not in provider labels.
 * Returns the first match found, or null if no role:level label exists.
 */
export function detectRoleLevelFromLabels(
  labels: string[],
): { role: RoleId; level: LevelId } | null {
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const role = parts[0]!.toLowerCase();
    const level = parts[1]!.toLowerCase();

    if (!isValidRole(role) || !isLevelId(level)) continue;

    const roleLevels = getLevelsForRole(role);

    if (roleLevels.includes(level)) {
      return { role, level };
    }
  }

  return null;
}

/**
 * Detect role from a label using workflow config.
 */
export function detectRoleFromStateLabel(
  label: StateLabel,
  workflow: WorkflowConfig<string, string, string>,
): string | null {
  return detectRoleFromLabel(workflow, label);
}

// ---------------------------------------------------------------------------
// Issue queue queries
// ---------------------------------------------------------------------------

export async function findNextIssueForRole(
  provider: Pick<IssueReader, "getIssue">,
  role: string,
  workflow: WorkflowConfig<string, string, string>,
  instanceName: string | undefined,
  localState: { workspaceDir: string; projectSlug: string },
): Promise<{ issue: Issue; label: string; localState: IssueRuntimeState } | null> {
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
  queueLabels: string[],
  instanceName: string | undefined,
  workspaceDir: string,
  projectSlug: string,
): Promise<{ issue: Issue; label: string; localState: IssueRuntimeState } | null> {
  const store = await readIssueStateStore(workspaceDir, projectSlug);
  const localCandidates = Object.values(store.issues)
    .filter((state) =>
      state.archivedAt == null
      && state.integrityStatus !== ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
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
