/** Persists exact worker delivery evidence shared by dispatch and recovery. */

import type { WorkerDeliveryState } from "../../domain/index.js";
import { updateIssueRuntimeRecord, updateSlot } from "../../state/index.js";
import type { WorkerDeliverySlotIdentity } from "./types.js";

/**
 * Replace the slot's unresolved-delivery marker only while this issue owns it.
 * @param workspaceDir - Workspace containing the reserved slot.
 * @param projectSlug - Project that owns the slot.
 * @param issueId - Issue that must still own the slot.
 * @param identity - Exact slot, session, and submission being updated.
 * @param delivery - Current uncertainty, or undefined after explicit acceptance.
 */
export async function recordSlotDelivery(
  workspaceDir: string, projectSlug: string, issueId: number,
  identity: WorkerDeliverySlotIdentity, delivery: WorkerDeliveryState | undefined,
): Promise<void> {
  await updateSlot(workspaceDir, projectSlug, identity.role, identity.level, identity.slotIndex, (slot) => {
    if (!slot.active || slot.issueId !== issueId || slot.sessionKey !== identity.sessionKey || slot.delivery?.operationId !== identity.deliveryId) return slot;

    return { ...slot, delivery };
  });
}

/**
 * Update issue delivery evidence without recreating a completed or reassigned worker.
 * @param workspaceDir - Workspace containing authoritative issue runtime state.
 * @param projectSlug - Project that owns the issue.
 * @param issueId - Provider-local issue identity.
 * @param sessionKey - Expected active worker session.
 * @param deliveryId - Exact submission token whose evidence may be updated.
 * @param delivery - Current uncertainty, or undefined after explicit acceptance.
 */
export async function recordIssueDelivery(
  workspaceDir: string, projectSlug: string, issueId: number, sessionKey: string,
  deliveryId: string | undefined, delivery: WorkerDeliveryState | undefined,
): Promise<void> {
  await updateIssueRuntimeRecord(workspaceDir, projectSlug, issueId, (state) => {
    if (!state) throw new Error(`Issue #${issueId} has no runtime state for delivery reconciliation.`);
    if (state.activeWorker?.sessionKey !== sessionKey || state.activeWorker.delivery?.operationId !== deliveryId) return state;

    return {
      ...state,
      activeWorker: { ...state.activeWorker, delivery },
      updatedAt: new Date().toISOString(),
    };
  });
}
