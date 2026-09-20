/**
 * Persists focused mutations of current managed-issue runtime records.
 */
import type { IssueRuntimeState } from "../../../domain/index.js";
import { updateIssueStateStore } from "./repository.js";

/**
 * Build and persist one runtime record from the fresh authoritative store snapshot.
 *
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Project that owns the issue.
 * @param issueId - Provider-local issue identifier.
 * @param build - Application-owned function that resolves the complete next record.
 */
export async function updateIssueRuntimeRecord(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  build: (previous: IssueRuntimeState | undefined) => IssueRuntimeState,
): Promise<IssueRuntimeState> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = build(store.issues[String(issueId)]);

    return {
      store: { ...store, issues: { ...store.issues, [String(issueId)]: state } },
      result: state,
    };
  });
}

/**
 * Persist the role-specific level selected for an initialized managed issue.
 *
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project that owns the issue.
 * @param issueId - Provider-local issue whose assignment changes.
 * @param role - Configured role selected for the issue.
 * @param level - Configured role level selected for the issue.
 */
export async function writeIssueRoleLevel(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  role: string,
  level: string,
): Promise<IssueRuntimeState> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state) throw new Error(`Issue #${issueId} has no initialized local runtime state.`);
    const updated: IssueRuntimeState = { ...state, assignedRole: role, assignedLevel: level, updatedAt: new Date().toISOString() };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: updated };
  });
}
