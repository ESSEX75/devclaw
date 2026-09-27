/** Resumes provider, slot, and issue effects authorized by a durable operator decision. */

import { log as auditLog } from "../../audit.js";
import { WORKER_DELIVERY_RESOLUTION } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/index.js";
import { readIssueStateStore, readProjects, updateIssueRuntimeRecord, updateProjects,   type WorkerDeliveryResolution,writeWorkerDeliveryResolution } from "../../state/index.js";
import { WORKER_AUDIT_EVENT } from "./const.js";

/** Apply idempotent effects under the caller's issue lock, retaining intent on every failure.
 * @param workspaceDir - Workspace containing ownership and recovery records.
 * @param projectSlug - Canonical project.
 * @param record - Immutable operator evidence persisted before effects.
 * @param provider - Required only for verified non-start queue restoration.
 */
export async function applyDeliveryResolution(
  workspaceDir: string, projectSlug: string, record: WorkerDeliveryResolution, provider: IssueProvider | undefined,
): Promise<void> {
  const nonStart = record.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED;
  const state = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(record.issueId)];

  if (!state) throw new Error("Issue disappeared during delivery resolution.");
  if (state.workflowState !== record.fromState && state.workflowState !== record.toState) {
    throw new Error("Issue workflow changed after the recorded delivery decision.");
  }

  if (state.activeWorker && (state.activeWorker.sessionKey !== record.sessionKey || state.activeWorker.startedAt !== record.startedAt
    || (state.activeWorker.delivery && state.activeWorker.delivery.operationId !== record.deliveryId))) {
    throw new Error("Issue belongs to a different worker delivery.");
  }

  if (!state.activeWorker && (!nonStart || state.workflowState !== record.toState)) throw new Error("Issue no longer matches the recorded resolution.");
  const projects = await readProjects(workspaceDir);
  const observedSlot = projects.projects[projectSlug]?.workers[record.role]?.levels[record.level]?.[record.slotIndex];

  if (observedSlot?.issueId === record.issueId && (observedSlot.sessionKey !== record.sessionKey
    || observedSlot.startTime !== record.startedAt
    || (observedSlot.delivery && observedSlot.delivery.operationId !== record.deliveryId))) {
    throw new Error("Worker slot belongs to a replacement delivery.");
  }

  if (nonStart) {
    if (!provider) throw new Error("Queue restoration requires a provider.");
    const issue = await provider.getIssue(record.issueId);

    if (!issue.labels.includes(record.toLabel) || issue.labels.includes(record.fromLabel)) await provider.transitionLabel(record.issueId, record.fromLabel, record.toLabel);
  }

  await updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const slots = data.projects[projectSlug]?.workers[record.role]?.levels[record.level];
    const slot = slots?.[record.slotIndex];
    const owns = slot?.issueId === record.issueId && slot.sessionKey === record.sessionKey && slot.startTime === record.startedAt;

    if (!owns) {
      if (!nonStart || slot?.issueId === record.issueId) throw new Error("Worker slot belongs to a replacement delivery.");

      return { data, result: undefined };
    }

    if (slot.delivery && slot.delivery.operationId !== record.deliveryId) throw new Error("Worker slot belongs to a different submission.");
    if (slots) slots[record.slotIndex] = nonStart
      ? { active: false, issueId: null, sessionKey: slot.sessionKey, startTime: null,
        previousLabel: null, name: slot.name, lastIssueId: record.issueId }
      : { ...slot, delivery: undefined };

    return { data, result: undefined };
  });
  await updateIssueRuntimeRecord(workspaceDir, projectSlug, record.issueId, (current) => {
    if (!current) throw new Error("Issue disappeared during delivery resolution.");
    const worker = current.activeWorker;

    if (worker && (worker.sessionKey !== record.sessionKey || worker.startedAt !== record.startedAt || (worker.delivery && worker.delivery.operationId !== record.deliveryId))) {
      throw new Error("Issue worker changed during delivery resolution.");
    }

    return { ...current, workflowState: record.toState, workflowLabel: record.toLabel,
      activeWorker: nonStart ? null : worker ? { ...worker, delivery: undefined } : null, updatedAt: new Date().toISOString() };
  });
  await writeWorkerDeliveryResolution(workspaceDir, projectSlug, { ...record, completed: true });
  await auditLog(workspaceDir, WORKER_AUDIT_EVENT.DELIVERY_RESOLVED, { projectSlug, issueId: record.issueId,
    deliveryId: record.deliveryId, sessionKey: record.sessionKey, decision: record.decision, reason: record.reason,
    fromLabel: record.fromLabel, toLabel: record.toLabel, actor: "operator" }).catch(() => {});
}
