/**
 * queue-scan.ts — Issue queue scanning helpers.
 *
 * Shared by: tick (projectTick), work-start (auto-pickup), and other consumers
 * that need to find queued issues or detect roles/levels from labels.
 */
import {
  detectRoleFromLabel,
  getQueueLabels,
  type IssueRuntimeState,
  type RoleDefinition,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import type { Issue, StateLabel } from "../../integrations/providers/provider.js";
import { ROLE_REGISTRY } from "../../roles/index.js";
import { isIssueCreationReady, readIssueStateStore } from "../../state/index.js";
import { selectLocalQueueCandidates } from "./select.js";

// ---------------------------------------------------------------------------
// Label detection
// ---------------------------------------------------------------------------

export function detectLevelFromLabels(
  labels: string[],
  roles: Readonly<Record<string, RoleDefinition<string>>> = ROLE_REGISTRY,
): string | null {
  // Match projected role:level labels (e.g., "developer:senior").
  // Provider label parsing is reserved for explicit migration and repair flows.
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const [role, level] = parts;

    if (role && level && roles[role]?.levels[level]) return level;
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
  roles: Readonly<Record<string, RoleDefinition<string>>> = ROLE_REGISTRY,
): { role: string; level: string } | null {
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const role = parts[0]!;
    const level = parts[1]!;

    if (roles[role]?.levels[level]) {
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
  workflow: WorkflowConfig,
): string | null {
  return detectRoleFromLabel(workflow, label);
}

// ---------------------------------------------------------------------------
// Issue queue queries
// ---------------------------------------------------------------------------

export async function findNextIssueForRole(
  provider: Pick<IssueReader, "getIssue">,
  role: string,
  workflow: WorkflowConfig,
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
  const localCandidates = selectLocalQueueCandidates(Object.values(store.issues), queueLabels, instanceName);

  for (const state of localCandidates) {
    if (!await isIssueCreationReady(workspaceDir, projectSlug, state.creationOperationId)) continue;
    try {
      const issue = await provider.getIssue(state.issueId);

      if (issue.state === "closed" || issue.state === "CLOSED") continue;

      return { issue, label: state.workflowLabel, localState: state };
    } catch {
      continue;
    }
  }

  return null;
}
