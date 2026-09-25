/** Persists evidence and escalation for an unresolved worker-turn submission. */
import { log as auditLog } from "../../audit.js";
import type { WorkerDeliveryState } from "../../domain/index.js";
import { WORKER_DELIVERY_STATUS } from "../../domain/index.js";
import { fetchGatewaySessions } from "../../integrations/openclaw/gateway-sessions.js";
import { getProject, getRoleWorker, readIssueStateStore, readProjects, updateSlot } from "../../state/index.js";
import { DELIVERY_ATTENTION_AFTER_MS } from "./const.js";
import { recordIssueDelivery } from "./state.js";
import type { UnknownDispatchInput } from "./types.js";

/**
 * Inspect a reserved slot and its issue without treating session absence as failed delivery.
 * A stale unresolved submission becomes visible for manual investigation after five minutes.
 * @param input - Issue, slot, session, and gateway evidence to inspect.
 */
export async function reconcileUncertainDispatch(input: UnknownDispatchInput): Promise<void> {
  const { workspaceDir, projectSlug, role, level, slotIndex, issueId, sessionKey, runCommand, reason } = input;
  const project = getProject(await readProjects(workspaceDir), projectSlug);
  const slot = project ? getRoleWorker(project, role).levels[level]?.[slotIndex] : undefined;
  const state = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];
  const slotOwned = slot?.active === true && slot.issueId === issueId && slot.sessionKey === sessionKey;
  const runtimeOwned = state?.activeWorker?.sessionKey === sessionKey;

  if (!slotOwned && !runtimeOwned) return;
  const marker = (slotOwned ? slot?.delivery : undefined)
    ?? (runtimeOwned ? state?.activeWorker?.delivery : undefined);

  if (!marker) return;
  const sessions = input.sessions !== undefined ? input.sessions : await fetchGatewaySessions(5_000, runCommand);
  const sessionObserved = sessions ? sessions.has(sessionKey) : null;
  const elapsed = Date.now() - Date.parse(marker.recordedAt);
  const observedSession = sessions?.get(sessionKey);
  const recentWorkerActivity = observedSession !== undefined
    && (observedSession.contextTokens ?? 0) > 0
    && Date.now() - observedSession.updatedAt < DELIVERY_ATTENTION_AFTER_MS;
  const escalate = marker.status !== WORKER_DELIVERY_STATUS.NEEDS_ATTENTION
    && Number.isFinite(elapsed) && elapsed >= DELIVERY_ATTENTION_AFTER_MS
    && !recentWorkerActivity;
  const status = marker.status === WORKER_DELIVERY_STATUS.NEEDS_ATTENTION || escalate
    ? WORKER_DELIVERY_STATUS.NEEDS_ATTENTION
    : input.outcomeUnknown || marker.status === WORKER_DELIVERY_STATUS.SUBMITTING
      ? WORKER_DELIVERY_STATUS.UNKNOWN : marker.status;
  const updated: WorkerDeliveryState = {
    status,
    recordedAt: marker.recordedAt,
    reason,
    checkedAt: new Date().toISOString(),
    sessionObserved,
  };

  if (slotOwned) {
    await updateSlot(workspaceDir, projectSlug, role, level, slotIndex, (current) => {
      if (!current.active || current.issueId !== issueId || current.sessionKey !== sessionKey) return current;

      return { ...current, delivery: updated };
    });
  }

  if (runtimeOwned) {
    await recordIssueDelivery(workspaceDir, projectSlug, issueId, sessionKey, updated);
  }

  if (escalate) {
    await auditLog(workspaceDir, "dispatch_delivery_needs_attention", {
      projectSlug, issueId, role, level, slotIndex, sessionKey,
      reason, slotOwned, runtimeOwned, sessionObserved,
      action: "Inspect the worker run and local issue/slot state before any manual retry.",
    });
  } else if (input.outcomeUnknown || marker.status === WORKER_DELIVERY_STATUS.SUBMITTING || !marker.checkedAt) {
    await auditLog(workspaceDir, "dispatch_delivery_unknown", {
      projectSlug, issueId, role, level, slotIndex, sessionKey,
      reason, slotOwned, runtimeOwned, sessionObserved,
    });
  }
}
