/** Applies an explicit operator conclusion to one unresolved worker delivery. */
import { log as auditLog } from "../../audit.js";
import { findStateKeyByLabel, getQueueLabels, STATE_TYPE } from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import {
  deactivateWorker,
  getProject,
  getRoleWorker,
  loadConfig,
  readIssueStateStore,
  readProjects,
  updateIssueRuntimeRecord,
  updateSlot,
  withIssueOrchestrationLock,
} from "../../state/index.js";
import { WORKER_DELIVERY_RESOLUTION } from "./const.js";
import { recordIssueDelivery } from "./state.js";
import type { ResolveWorkerDeliveryInput, ResolveWorkerDeliveryResult } from "./types.js";

/**
 * Preview or apply a verified operator conclusion for a still-reserved worker turn.
 * A confirmed non-start restores the provider queue label before releasing the slot;
 * an ambiguous gateway response alone is never accepted as proof of non-start.
 * @param input - Exact issue/session identity, provider, workflow, and explicit operator decision.
 */
export async function resolveWorkerDelivery(input: ResolveWorkerDeliveryInput): Promise<ResolveWorkerDeliveryResult> {
  if (!input.reason.trim()) throw new Error("A worker delivery resolution requires an operator reason.");
  if (!input.sessionKey.trim()) throw new Error("An exact worker session key is required.");
  if (input.decision !== WORKER_DELIVERY_RESOLUTION.CONFIRMED_STARTED
    && input.decision !== WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED) {
    throw new Error(`Unknown worker delivery decision: ${input.decision}`);
  }

  return withIssueOrchestrationLock(input.workspaceDir, input.projectSlug, input.issueId, async () => {
    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);

    if (!project) throw new Error(`Project not found: ${input.projectSlug}`);
    const state = (await readIssueStateStore(input.workspaceDir, input.projectSlug)).issues[String(input.issueId)];
    const worker = state?.activeWorker;

    if (!worker || worker.sessionKey !== input.sessionKey) {
      throw new Error(`Issue #${input.issueId} does not own session ${input.sessionKey}.`);
    }

    const slot = getRoleWorker(project, worker.role).levels[worker.level]?.[worker.slotIndex];

    if (!slot?.active || slot.issueId !== input.issueId || slot.sessionKey !== input.sessionKey) {
      throw new Error(`Issue #${input.issueId} no longer owns its expected worker slot.`);
    }

    if (!worker.delivery && !slot.delivery) {
      throw new Error(`Issue #${input.issueId} has no unresolved worker delivery.`);
    }

    const workflow = input.workflow ?? (await loadConfig(input.workspaceDir, input.projectSlug)).workflow;

    const toLabel = input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED
      ? slot.previousLabel : state.workflowLabel;

    if (!toLabel) throw new Error(`Issue #${input.issueId} has no previous queue label to restore.`);

    if (input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED
      && !getQueueLabels(workflow, worker.role).includes(toLabel)) {
      throw new Error(`Previous label "${toLabel}" is not a queue for role ${worker.role}.`);
    }

    if (input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED
      && workflow.states[state.workflowState]?.type !== STATE_TYPE.ACTIVE) {
      throw new Error(`Issue #${input.issueId} is no longer in an active workflow state.`);
    }

    let provider: IssueProvider | undefined;
    let queueState: string | null | undefined;

    if (input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED) {
      provider = input.provider;

      if (!provider) {
        if (!input.runCommand) throw new Error("runCommand is required to resolve an unstarted worker delivery.");
        provider = (await createProvider({
          repo: project.repo, provider: project.provider, runCommand: input.runCommand, workflow,
        })).provider;
      }

      const issue = await provider.getIssue(input.issueId);

      if (!issue.labels.includes(state.workflowLabel)) {
        throw new Error(`Provider issue #${input.issueId} no longer has active label "${state.workflowLabel}".`);
      }

      queueState = findStateKeyByLabel(workflow, toLabel);

      if (!queueState) throw new Error(`No workflow state exists for queue label "${toLabel}".`);
    }

    const result: ResolveWorkerDeliveryResult = {
      applied: input.apply,
      projectSlug: input.projectSlug,
      issueId: input.issueId,
      sessionKey: input.sessionKey,
      decision: input.decision,
      fromLabel: state.workflowLabel,
      toLabel,
    };

    if (!input.apply) return result;

    if (input.decision === WORKER_DELIVERY_RESOLUTION.CONFIRMED_STARTED) {
      await updateSlot(input.workspaceDir, input.projectSlug, worker.role, worker.level, worker.slotIndex, (current) => {
        if (!current.active || current.issueId !== input.issueId || current.sessionKey !== input.sessionKey) {
          throw new Error("Worker slot changed during delivery resolution.");
        }

        return { ...current, delivery: undefined };
      });
      await recordIssueDelivery(input.workspaceDir, input.projectSlug, input.issueId, input.sessionKey, undefined);
    } else {
      if (!provider || !queueState) throw new Error("Worker delivery preview did not verify the queue transition.");
      await provider.transitionLabel(input.issueId, state.workflowLabel, toLabel);
      await deactivateWorker(input.workspaceDir, input.projectSlug, worker.role, {
        level: worker.level, slotIndex: worker.slotIndex, issueId: input.issueId,
      });
      await updateIssueRuntimeRecord(input.workspaceDir, input.projectSlug, input.issueId, (current) => {
        if (!current || current.activeWorker?.sessionKey !== input.sessionKey) {
          throw new Error("Issue worker changed during delivery resolution.");
        }

        return {
          ...current,
          workflowState: queueState,
          workflowLabel: toLabel,
          activeWorker: null,
          updatedAt: new Date().toISOString(),
        };
      });
    }

    await auditLog(input.workspaceDir, "dispatch_delivery_resolved", {
      projectSlug: input.projectSlug, issueId: input.issueId,
      sessionKey: input.sessionKey, decision: input.decision,
      reason: input.reason.trim(), fromLabel: result.fromLabel, toLabel,
      actor: "operator",
    }).catch(() => { });

    return result;
  });
}
