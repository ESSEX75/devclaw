/** Records operator evidence before resuming one exact worker-delivery resolution. */

import { findStateKeyByLabel, getQueueLabels, STATE_TYPE, WORKER_DELIVERY_RESOLUTION } from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import { getProject, getRoleWorker, loadConfig, readIssueStateStore, readProjects,
  readWorkerDeliveryResolution, withIssueOrchestrationLock,   type WorkerDeliveryResolution,writeWorkerDeliveryResolution } from "../../state/index.js";
import { applyDeliveryResolution } from "./resolution-effects.js";
import type { ResolveWorkerDeliveryInput, ResolveWorkerDeliveryResult } from "./types.js";

/** Preview or resume the same immutable decision; session absence never proves non-start.
 * @param input - Exact submission, operator evidence, and resolved capabilities.
 */
export async function resolveWorkerDelivery(input: ResolveWorkerDeliveryInput): Promise<ResolveWorkerDeliveryResult> {
  if (!input.reason.trim()) throw new Error("A worker delivery resolution requires an operator reason.");
  if (!input.sessionKey.trim() || !input.deliveryId.trim()) throw new Error("Exact session and delivery operation identities are required.");
  if (input.decision !== WORKER_DELIVERY_RESOLUTION.CONFIRMED_STARTED
    && input.decision !== WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED) throw new Error(`Unknown worker delivery decision: ${input.decision}`);

  return withIssueOrchestrationLock(input.workspaceDir, input.projectSlug, input.issueId, async () => {
    const previous = await readWorkerDeliveryResolution(input.workspaceDir, input.projectSlug, input.issueId);
    const existing = previous?.deliveryId === input.deliveryId ? previous : undefined;

    if (previous && !previous.completed && !existing) throw new Error("Resume the pending delivery resolution before another operation.");
    if (existing && (existing.decision !== input.decision || existing.sessionKey !== input.sessionKey)) {
      throw new Error("The recorded decision cannot change; there is no unresolved worker delivery for another conclusion.");
    }

    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);

    if (!project) throw new Error(`Project not found: ${input.projectSlug}`);
    const workflow = input.workflow ?? (await loadConfig(input.workspaceDir, input.projectSlug)).workflow;
    const record = existing ?? await prepareDeliveryResolution(input, workflow);
    const result: ResolveWorkerDeliveryResult = {
      applied: input.apply, projectSlug: input.projectSlug, issueId: input.issueId, sessionKey: record.sessionKey,
      deliveryId: record.deliveryId, decision: record.decision, fromLabel: record.fromLabel, toLabel: record.toLabel,
    };

    if (record.completed) return result;
    const provider = record.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED
      ? input.provider ?? (input.runCommand ? (await createProvider({ repo: project.repo, provider: project.provider,
        runCommand: input.runCommand, workflow })).provider : undefined) : undefined;

    if (record.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED) {
      if (!provider) throw new Error("A provider or runCommand is required to restore the queue.");
      if (!getQueueLabels(workflow, record.role).includes(record.toLabel) || workflow.states[record.toState]?.label !== record.toLabel) {
        throw new Error("The recorded queue destination no longer matches the workflow; inspect configuration before resuming.");
      }

      const issue = await provider.getIssue(input.issueId);

      if (!issue.labels.includes(record.fromLabel) && !issue.labels.includes(record.toLabel)) {
        throw new Error("Provider labels no longer match this delivery resolution.");
      }
    }

    if (!input.apply) return result;
    if (!existing) await writeWorkerDeliveryResolution(input.workspaceDir, input.projectSlug, record);
    await applyDeliveryResolution(input.workspaceDir, input.projectSlug, record, provider);

    return result;
  });
}

/** Validate fresh ownership before recording operator authorization.
 * @param input - Exact operator request.
 * @param workflow - Resolved workflow validating queue restoration.
 */
async function prepareDeliveryResolution(
  input: ResolveWorkerDeliveryInput, workflow: NonNullable<ResolveWorkerDeliveryInput["workflow"]>,
): Promise<WorkerDeliveryResolution> {
  const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);
  const state = (await readIssueStateStore(input.workspaceDir, input.projectSlug)).issues[String(input.issueId)];
  const worker = state?.activeWorker;

  if (!project || !worker || worker.sessionKey !== input.sessionKey) throw new Error(`Issue #${input.issueId} does not own session ${input.sessionKey}.`);
  const slot = getRoleWorker(project, worker.role).levels[worker.level]?.[worker.slotIndex];

  if (!slot?.active || slot.issueId !== input.issueId || slot.sessionKey !== input.sessionKey) throw new Error("Issue no longer owns its expected worker slot.");
  const marker = worker.delivery ?? slot.delivery;

  if (!marker || marker.operationId !== input.deliveryId
    || (worker.delivery && worker.delivery.operationId !== input.deliveryId)
    || (slot.delivery && slot.delivery.operationId !== input.deliveryId)) throw new Error("Issue has no unresolved worker delivery with that operation ID.");
  const nonStart = input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED;
  const toLabel = nonStart ? slot.previousLabel : state.workflowLabel;
  const toState = toLabel ? findStateKeyByLabel(workflow, toLabel) : null;

  if (!toLabel || !toState || (nonStart && (!getQueueLabels(workflow, worker.role).includes(toLabel)
    || workflow.states[state.workflowState]?.type !== STATE_TYPE.ACTIVE))) throw new Error("Previous state is not a valid queue for this active worker.");

  return { deliveryId: input.deliveryId, issueId: input.issueId, sessionKey: input.sessionKey,
    role: worker.role, level: worker.level, slotIndex: worker.slotIndex, startedAt: slot.startTime ?? worker.startedAt,
    decision: input.decision, reason: input.reason.trim(), fromState: state.workflowState, fromLabel: state.workflowLabel,
    toState, toLabel, completed: false };
}
