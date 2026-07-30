/**
 * queue-scan.ts — Issue queue scanning helpers.
 *
 * Shared by: tick (projectTick), work-start (auto-pickup), and other consumers
 * that need to find queued issues or detect roles/levels from labels.
 */
import type { IssueRuntimeState } from "../../domain/index.js";
import type { ResolvedWorkflowConfig } from "../../domain/index.js";
import { ISSUE_INTEGRITY_STATUS } from "../../domain/index.js";
import { isOwnedByOrUnclaimed } from "../../domain/index.js";
import {
  detectRoleFromLabel,
  getQueueLabels,
} from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import type { Issue, StateLabel } from "../../integrations/providers/provider.js";
import { ROLE_REGISTRY } from "../../roles/index.js";
import { readIssueStateStore } from "../../state/issues/index.js";

// ---------------------------------------------------------------------------
// Label detection
// ---------------------------------------------------------------------------

export function detectLevelFromLabels(
  labels: string[],
  roles: Readonly<Record<string, { levels: readonly string[] }>> = ROLE_REGISTRY,
): string | null {
  // Match projected role:level labels (e.g., "developer:senior").
  // Managed dispatch uses issues.json first; labels are only a compatibility fallback.
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const [role, level] = parts;

    if (role && level && roles[role]?.levels.includes(level)) return level;
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
  roles: Readonly<Record<string, { levels: readonly string[] }>> = ROLE_REGISTRY,
): { role: string; level: string } | null {
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const role = parts[0]!;
    const level = parts[1]!;

    if (roles[role]?.levels.includes(level)) {
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
  workflow: ResolvedWorkflowConfig,
): string | null {
  return detectRoleFromLabel(workflow, label);
}

// ---------------------------------------------------------------------------
// Issue queue queries
// ---------------------------------------------------------------------------

export async function findNextIssueForRole(
  provider: Pick<IssueReader, "getIssue">,
  role: string,
  workflow: ResolvedWorkflowConfig,
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
