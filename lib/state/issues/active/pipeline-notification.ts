/** Persists notification attempt ownership and evidence without repeating uncertain sends. */

import { PIPELINE_NOTIFICATION_STATUS, type PipelineNotificationState } from "../../../domain/index.js";
import { PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS } from "../const.js";
import { updateIssueStateStore } from "./repository.js";

/** Reserve one attempt and return its timestamp token. Expired in-flight attempts become unknown.
 * Blocked and proven unsubmitted attempts become eligible after the backoff lease.
 * @param workspaceDir - Workspace containing managed state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Managed issue identifier.
 * @param eventKey - Stable terminal event identity.
 * @param now - Time used to evaluate the lease.
 */
export async function reservePipelineNotification(
  workspaceDir: string, projectSlug: string, issueId: number, eventKey: string, now = new Date(),
): Promise<string | null> {
  return updateIssueStateStore<string | null>(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state) throw new Error(`Issue #${issueId} has no initialized local runtime state.`);
    const previous = state.pipelineNotification;

    if (previous) {
      // Unresolved events cannot be overwritten by another terminal event.
      if (previous.eventKey !== eventKey && previous.status !== PIPELINE_NOTIFICATION_STATUS.DELIVERED) return { store, result: null };
      if (previous.eventKey === eventKey) {
        if (previous.status === PIPELINE_NOTIFICATION_STATUS.DELIVERED || previous.status === PIPELINE_NOTIFICATION_STATUS.UNKNOWN) return { store, result: null };
        if (previous.status !== PIPELINE_NOTIFICATION_STATUS.PENDING
          && Date.parse(previous.attemptedAt) + PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS > now.getTime()) return { store, result: null };
        if (previous.status === PIPELINE_NOTIFICATION_STATUS.ATTEMPTING) {
          const updated = { ...state, updatedAt: now.toISOString(), pipelineNotification: {
            ...previous, status: PIPELINE_NOTIFICATION_STATUS.UNKNOWN,
            reason: "Attempt lease expired without a delivery outcome. Inspect the destination before any retry.",
          } };

          return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: null };
        }
      }
    }

    const attemptedAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.attemptedAt) + 1 : 0)).toISOString();
    const updated = { ...state, updatedAt: attemptedAt, pipelineNotification: {
      eventKey, status: PIPELINE_NOTIFICATION_STATUS.ATTEMPTING, attemptedAt,
    } };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: attemptedAt };
  });
}

/** Settle only the owned attempt; late results cannot overwrite another attempt or delivered evidence.
 * An expired attempt may still receive its own definitive late result.
 * @param workspaceDir - Workspace containing managed state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Managed issue identifier.
 * @param eventKey - Reserved terminal event identity.
 * @param attemptedAt - Exact reservation token returned before sending.
 * @param status - Observed delivery or retry eligibility.
 * @param reason - Failure diagnostic or reconciliation instructions.
 */
export async function settlePipelineNotification(
  workspaceDir: string, projectSlug: string, issueId: number, eventKey: string, attemptedAt: string,
  status: Exclude<PipelineNotificationState["status"], typeof PIPELINE_NOTIFICATION_STATUS.ATTEMPTING | typeof PIPELINE_NOTIFICATION_STATUS.PENDING>, reason?: string,
): Promise<boolean> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];
    const previous = state?.pipelineNotification;

    if (!state || !previous || previous.eventKey !== eventKey || previous.attemptedAt !== attemptedAt
      || (previous.status !== PIPELINE_NOTIFICATION_STATUS.ATTEMPTING && previous.status !== PIPELINE_NOTIFICATION_STATUS.UNKNOWN)) return { store, result: false };
    const now = new Date().toISOString();
    const updated = { ...state, updatedAt: now, pipelineNotification: {
      ...previous, status, reason,
      ...(status === PIPELINE_NOTIFICATION_STATUS.DELIVERED ? { deliveredAt: now } : {}),
    } };

    return { store: { ...store, issues: { ...store.issues, [String(issueId)]: updated } }, result: true };
  });
}
