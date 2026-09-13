/**
 * Persists focused mutations of current managed-issue runtime records.
 */
import {
  type IssueRuntimeState,
  PIPELINE_NOTIFICATION_STATUS,
} from "../../../domain/index.js";
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

/** Reserve a terminal notification once, preventing duplicate delivery attempts. */
export async function reservePipelineNotification(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  eventKey: string,
): Promise<boolean> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state) throw new Error(`Issue #${issueId} has no initialized local runtime state.`);
    if (state.pipelineNotification?.eventKey === eventKey) return { store, result: false };
    const updated: IssueRuntimeState = {
      ...state,
      pipelineNotification: {
        eventKey,
        status: PIPELINE_NOTIFICATION_STATUS.ATTEMPTING,
        attemptedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: true };
  });
}

/** Confirm successful delivery of a previously reserved terminal notification. */
export async function confirmPipelineNotification(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  eventKey: string,
): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state || state.pipelineNotification?.eventKey !== eventKey) {
      throw new Error(`Issue #${issueId} has no reserved pipeline notification ${eventKey}.`);
    }

    const deliveredAt = new Date().toISOString();
    const updated: IssueRuntimeState = {
      ...state,
      pipelineNotification: { ...state.pipelineNotification, status: PIPELINE_NOTIFICATION_STATUS.DELIVERED, deliveredAt },
      updatedAt: deliveredAt,
    };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: undefined };
  });
}

/** Persist the role-specific level selected for an initialized managed issue. */
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
