/** Owns worker-slot reservation and the authoritative issue runtime commit. */

import type { WorkerDeliveryState } from "../../domain/index.js";
import {
  hasTestPhase, ISSUE_PROVIDER, producesReviewableWork, REVIEW_POLICY, TEST_POLICY, WORKER_DELIVERY_STATUS,
} from "../../domain/index.js";
import type { ResolvedConfig } from "../../state/index.js";
import { activateWorker, readIssueStateStore, updateIssueRuntimeRecord, updateSlot } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import { WORKER_DISPATCH_OWNER } from "./const.js";
import type { DispatchAttempt, DispatchOpts } from "./types.js";

/**
 * Reserve a concrete slot before provider and gateway side effects begin.
 * @param opts - Dispatch identity and project state location.
 * @param plan - Selected role, level, slot, and session key.
 */
export async function reserveDispatchSlot(opts: DispatchOpts, plan: DispatchAttempt): Promise<void> {
  await activateWorker(opts.workspaceDir, opts.project.slug, plan.role, {
    issueId: opts.issueId,
    level: plan.level,
    sessionKey: plan.sessionKey,
    startTime: plan.startedAt,
    previousLabel: opts.fromLabel,
    slotIndex: plan.slotIndex,
    name: plan.botName,
    delivery: {
      operationId: plan.deliveryId,
      status: WORKER_DELIVERY_STATUS.SUBMITTING,
      recordedAt: plan.startedAt,
      reason: "Worker turn submission has not been confirmed.",
    },
  });
}

/**
 * Replace the slot's unresolved-delivery marker only while this issue owns it.
 * @param opts - Dispatch identity and project state location.
 * @param plan - Exact slot and session identity reserved for this attempt.
 * @param delivery - Current uncertainty, or undefined after explicit acceptance.
 */
export async function recordSlotDelivery(opts: DispatchOpts, plan: DispatchAttempt, delivery: WorkerDeliveryState | undefined): Promise<void> {
  await updateSlot(opts.workspaceDir, opts.project.slug, plan.role, plan.level, plan.slotIndex, (slot) => {
    if (!slot.active || slot.issueId !== opts.issueId || slot.sessionKey !== plan.sessionKey || slot.delivery?.operationId !== plan.deliveryId) return slot;

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

/**
 * Release only the slot still assigned to this issue after confirmed pre-delivery failure.
 * @param opts - Dispatch identity and project state location.
 * @param plan - Exact role, level, and slot reserved for this attempt.
 */
export async function releaseDispatchSlot(opts: DispatchOpts, plan: DispatchAttempt): Promise<void> {
  await updateSlot(opts.workspaceDir, opts.project.slug, plan.role, plan.level, plan.slotIndex, (slot) => {
    if (slot.issueId !== opts.issueId || slot.sessionKey !== plan.sessionKey || slot.delivery?.operationId !== plan.deliveryId) {
      throw new Error("Worker reservation changed before release.");
    }

    return { active: false, issueId: null, sessionKey: slot.sessionKey, startTime: null,
      previousLabel: null, name: slot.name, lastIssueId: opts.issueId };
  });
}

/**
 * Persist the active worker from local truth, then reconcile its provider projection.
 * The caller holds the issue lock and retains the slot if this post-delivery step fails.
 * @param opts - Issue, project, provider, and ownership inputs.
 * @param plan - Worker identity selected before delivery.
 * @param config - Resolved workflow and roles used for projection.
 * @param providerLabels - Provider issue labels read after transition.
 * @param delivery - Unresolved submission marker, absent after confirmed acceptance.
 */
export async function commitWorkerDispatch(
  opts: DispatchOpts,
  plan: DispatchAttempt,
  config: ResolvedConfig,
  providerLabels: string[],
  delivery?: WorkerDeliveryState,
): Promise<void> {
  const { workspaceDir, project, issueId, role, level, fromLabel, toLabel, provider } = opts;
  const { workflow } = config;
  const current = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];
  const owner = current?.owner ?? opts.instanceName ?? null;
  const reviewPolicy = producesReviewableWork(workflow, role)
    ? workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN : null;
  const testPolicy = hasTestPhase(workflow)
    ? workflow.testPolicy ?? TEST_POLICY.SKIP : null;

  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: {
      iid: issueId,
      labels: providerLabels
        .filter((label) => label !== fromLabel && !label.startsWith(`${role}:`))
        .concat(toLabel, `${role}:${level}`),
    },
    providerType: project.provider === ISSUE_PROVIDER.GITHUB ? ISSUE_PROVIDER.GITHUB : ISSUE_PROVIDER.GITLAB,
    workflow,
    workflowLabel: toLabel,
    assignedRole: role,
    assignedLevel: level,
    owner,
    reviewPolicy,
    testPolicy,
    activeWorker: {
      role, level, slotIndex: plan.slotIndex, sessionKey: plan.sessionKey,
      startedAt: plan.startedAt,
      delivery,
    },
  });
  await reconcileManagedLabelsLocked({
    workspaceDir,
    projectSlug: project.slug,
    issueId,
    workflow,
    roles: Object.keys(config.roles),
    provider,
    owner: WORKER_DISPATCH_OWNER,
  });
}
