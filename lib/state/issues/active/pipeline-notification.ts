/**
 * Persists atomic reservation and delivery state for managed-issue pipeline notifications.
 */
import {
  type IssueRuntimeState,
  PIPELINE_NOTIFICATION_STATUS,
} from "../../../domain/index.js";
import { PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS } from "../const.js";
import { updateIssueStateStore } from "./repository.js";

/**
 * Reserve a terminal notification unless it was delivered or still has a live attempt lease.
 *
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project that owns the issue.
 * @param issueId - Provider-local issue receiving the terminal notification.
 * @param eventKey - Stable terminal event identity used for deduplication.
 * @param now - Current time used to establish and evaluate the attempt lease.
 */
export async function reservePipelineNotification(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  eventKey: string,
  now = new Date(),
): Promise<boolean> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state) throw new Error(`Issue #${issueId} has no initialized local runtime state.`);
    const previous = state.pipelineNotification;

    if (previous?.eventKey === eventKey) {
      if (previous.status === PIPELINE_NOTIFICATION_STATUS.DELIVERED) return { store, result: false };
      const leaseExpiresAt = Date.parse(previous.attemptedAt) + PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS;

      if (leaseExpiresAt > now.getTime()) return { store, result: false };
    }

    const attemptedAt = now.toISOString();
    const updated: IssueRuntimeState = {
      ...state,
      pipelineNotification: {
        eventKey,
        status: PIPELINE_NOTIFICATION_STATUS.ATTEMPTING,
        attemptedAt,
      },
      updatedAt: attemptedAt,
    };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: true };
  });
}

/**
 * Confirm successful delivery of a previously reserved terminal notification.
 *
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project that owns the issue.
 * @param issueId - Provider-local issue whose delivery is confirmed.
 * @param eventKey - Stable terminal event identity expected in the reservation.
 */
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
