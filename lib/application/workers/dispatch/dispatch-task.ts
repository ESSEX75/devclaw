/**
 * Coordinates atomic worker reservation, provider transition, session dispatch, and runtime persistence.
 * This application capability owns the dispatch use case while state retains worker-slot authority.
 */

import { randomUUID } from "node:crypto";

import { log as auditLog } from "../../../audit.js";
import type { WorkerDeliveryState } from "../../../domain/index.js";
import { emptySlot, ISSUE_INTEGRITY_STATUS, NOTIFICATION_CHANNEL, WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import { AGENT_TURN_STATUS } from "../../../integrations/openclaw/const.js";
import { ensureSessionFireAndForget, shouldClearSession } from "../../../integrations/openclaw/session.js";
import { deleteWorkerSession } from "../../../integrations/openclaw/session-cleanup.js";
import { isIssueCreationReady, loadConfig } from "../../../state/index.js";
import { readIssueStateStore, readWorkerDeliveryResolution, withIssueOrchestrationLock } from "../../../state/index.js";
import { getProject, getRoleWorker, readProjects } from "../../../state/index.js";
import { getNotificationConfig, notify } from "../../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../../notifications/resolve-endpoint.js";
import { acknowledgeComments, EYES_EMOJI } from "../../review/index.js";
import { buildAnnouncement, formatSessionLabel } from "../../tasks/index.js";
import { WORKER_AUDIT_EVENT } from "../const.js";
import { reconcileUncertainDispatch } from "../delivery-recovery/index.js";
import { recordSlotDelivery } from "../delivery-state.js";
import { auditDispatch, dispatchErrorMessage } from "./audit.js";
import { settleDispatchDelivery } from "./delivery-settlement.js";
import { loadDispatchContext } from "./dispatch-context.js";
import { buildDispatchPlan } from "./plan.js";
import { beginWorkerDelivery } from "./session-delivery.js";
import { commitWorkerDispatch, releaseDispatchSlot, reserveDispatchSlot } from "./state.js";
import type { DispatchOpts, DispatchResult } from "./types.js";

/**
 * Dispatch a task to a worker session.
 *
 * Flow:
 *   1. Resolve model, session key, and task context.
 *   2. Atomically reserve the selected worker slot.
 *   3. Transition the provider label and send notification.
 *   4. Ensure the session and send the task to the agent.
 *   5. Persist issue runtime state and audit the dispatch.
 *
 * Failures before agent send release the slot and best-effort restore the provider label.
 * State update failures after dispatch are audited because the session is already running.
 *
 * @param opts - Validated project, issue, worker, provider, and runtime dispatch dependencies.
 */
export async function dispatchTask(
  opts: DispatchOpts,
): Promise<DispatchResult> {
  return withIssueOrchestrationLock(
    opts.workspaceDir,
    opts.project.slug,
    opts.issueId,
    () => dispatchTaskLocked(opts),
  );
}

/**
 * Dispatch while the caller already owns this issue's orchestration lock.
 *
 * @param opts - Validated project, issue, worker, provider, and runtime dispatch dependencies.
 */
export async function dispatchTaskLocked(
  opts: DispatchOpts,
): Promise<DispatchResult> {
  const {
    workspaceDir, agentId, project, issueId, issueTitle,
    issueUrl, role, level, fromLabel, toLabel,
    provider, pluginConfig, runtime,
  } = opts;

  const slotIndex = opts.slotIndex ?? 0;
  const rc = opts.runCommand;

  // ── Setup (no side effects — safe to fail) ──────────────────────────
  const existingState = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];
  const resolution = await readWorkerDeliveryResolution(workspaceDir, project.slug, issueId);

  if (resolution && !resolution.completed) throw new Error(`Issue #${issueId} has a pending operator delivery resolution.`);

  if (existingState?.activeWorker || existingState?.pendingWorkerRelease) throw new Error(`Issue #${issueId} already has an active worker.`);
  if (existingState?.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${issueId} has integrity_error and cannot be dispatched.`);
  }

  if (existingState && !await isIssueCreationReady(workspaceDir, project.slug, existingState.creationOperationId)) {
    throw new Error(`Issue #${issueId} has an unfinished creation operation.`);
  }

  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const resolvedRole = resolvedConfig.roles[role];

  if (!resolvedRole?.enabled) throw new Error(`Role "${role}" is not configured or is disabled.`);
  const { timeouts } = resolvedConfig;
  const freshProject = getProject(await readProjects(workspaceDir), project.slug);

  if (!freshProject) throw new Error(`Project not found: ${project.slug}`);
  const alreadyReserved = Object.values(freshProject.workers).some((worker) =>
    Object.values(worker.levels).some((slots) => slots?.some((candidate) => candidate.active && candidate.issueId === issueId)));

  if (alreadyReserved) throw new Error(`Issue #${issueId} already has a reserved worker slot.`);
  const roleWorker = getRoleWorker(freshProject, role);
  const slot = roleWorker.levels[level]?.[slotIndex] ?? emptySlot();

  if (slot.active || (slot.issueId !== null && slot.issueId !== issueId)) {
    throw new Error(`Worker slot ${role}:${level}:${slotIndex} is already reserved and requires reconciliation.`);
  }

  const clearExisting = Boolean(slot.sessionKey && timeouts.sessionContextBudget < 1
    && await shouldClearSession(slot.sessionKey, slot.issueId, issueId, timeouts, workspaceDir, project.name, rc));
  const plan = { ...buildDispatchPlan({
    project, agentId, issueId, role, level, slotIndex, slot, resolvedRole, clearExisting,
  }), deliveryId: randomUUID(), startedAt: new Date().toISOString() };
  const { model, botName, sessionKey, sessionKeyToDelete, sessionAction } = plan;

  const context = await loadDispatchContext(opts, resolvedConfig);
  const { comments, prFeedback, isConflictFix, taskMessage, roleInstructions } = context;

  await reserveDispatchSlot(opts, plan, resolvedConfig);
  let taskDispatched = false;
  let providerTransitioned = false;

  try {
    if (sessionKeyToDelete) {
      await deleteWorkerSession(sessionKeyToDelete, rc).catch(() => {});
    }

    // ── Provider transition — compensated if agent send does not begin ──
    await provider.transitionLabel(issueId, fromLabel, toLabel);
    providerTransitioned = true;

    const issue = await provider.getIssue(issueId);

    // Ensure session exists (fire-and-forget — don't wait for gateway)
    // Session key is deterministic, so we can proceed immediately
    const sessionLabel = formatSessionLabel(project.name, role, level, botName);

    ensureSessionFireAndForget(sessionKey, model, workspaceDir, rc, timeouts.sessionPatchMs, sessionLabel);

    // Model is set on the session via sessions.patch, not on the agent RPC —
    // the gateway's agent endpoint rejects unknown properties like 'model'.
    const delivery = await beginWorkerDelivery(sessionKey, taskMessage, {
      agentId, projectName: project.name, issueId, role, level, slotIndex, fromLabel,
      orchestratorSessionKey: opts.sessionKey, workspaceDir,
      dispatchTimeoutMs: timeouts.dispatchMs,
      extraSystemPrompt: roleInstructions.trim() || undefined,
      runCommand: rc,
    });

    if (delivery.initial.kind === AGENT_TURN_STATUS.REJECTED) throw new Error(delivery.initial.reason);
    taskDispatched = true;

    const deliveryStatus = delivery.initial.kind === WORKER_DELIVERY_STATUS.PENDING ? WORKER_DELIVERY_STATUS.PENDING
      : delivery.initial.kind === AGENT_TURN_STATUS.UNKNOWN ? AGENT_TURN_STATUS.UNKNOWN : AGENT_TURN_STATUS.ACCEPTED;
    const unresolved: WorkerDeliveryState | undefined = delivery.initial.kind === AGENT_TURN_STATUS.ACCEPTED ? undefined : {
      operationId: plan.deliveryId,
      status: delivery.initial.kind === WORKER_DELIVERY_STATUS.PENDING ? WORKER_DELIVERY_STATUS.PENDING : WORKER_DELIVERY_STATUS.UNKNOWN,
      recordedAt: plan.startedAt,
      reason: delivery.initial.kind === WORKER_DELIVERY_STATUS.PENDING
        ? "Gateway command is still running; turn acceptance is unconfirmed."
        : delivery.initial.reason,
    };

    await recordSlotDelivery(opts.workspaceDir, opts.project.slug, opts.issueId, plan, unresolved).catch(() => { });

    // Notify only after the gateway did not explicitly reject delivery.
    const notifyConfig = getNotificationConfig(pluginConfig);
    const notifyTarget = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId).catch(() => undefined);

    notify({
      type: "workerStart", project: project.name, issueId, issueTitle, issueUrl,
      role, level, name: botName, sessionAction,
    }, {
      workspaceDir, config: notifyConfig,
      channelId: notifyTarget?.channelId,
      channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
      threadId: notifyTarget?.threadId, runtime,
      accountId: notifyTarget?.accountId,
      agentId: project.agentId, runCommand: rc,
    }).catch((err) => {
      auditLog(workspaceDir, WORKER_AUDIT_EVENT.WARNING, {
        step: "notify", issue: issueId, role, error: dispatchErrorMessage(err),
      }).catch(() => { });
    });

    // Commit active runtime state after delivery is accepted or remains uncertain.
    try {
      await commitWorkerDispatch(opts, plan, resolvedConfig, issue.labels, unresolved);
    } catch (err) {
      // Session is already dispatched — log warning but don't fail
      await auditLog(workspaceDir, WORKER_AUDIT_EVENT.DISPATCH, {
        project: project.name, issue: issueId, role,
        warning: "State update failed after successful dispatch",
        error: dispatchErrorMessage(err), sessionKey,
      }).catch(() => { });
    }

    if (delivery.initial.kind === AGENT_TURN_STATUS.UNKNOWN) {
      await reconcileUncertainDispatch({
        workspaceDir, projectSlug: project.slug, role, level, slotIndex, issueId, sessionKey, deliveryId: plan.deliveryId,
        runCommand: rc, reason: delivery.initial.reason, outcomeUnknown: true,
      })
        .catch(() => { });
    }

    if (delivery.initial.kind === WORKER_DELIVERY_STATUS.PENDING) {
      delivery.settled.then((outcome) => settleDispatchDelivery(opts, plan, context, outcome)).catch(() => {});
    }

    if (delivery.initial.kind === AGENT_TURN_STATUS.ACCEPTED) {
      provider.reactToIssue(issueId, EYES_EMOJI).catch(() => {});
      provider.reactToPr(issueId, EYES_EMOJI).catch(() => {});
      acknowledgeComments(provider, issueId, isConflictFix ? [] : comments, prFeedback, workspaceDir).catch(() => {});
    }

    // Audit successful reservation and the observed delivery status.
    await auditDispatch(workspaceDir, {
      project: project.name, issueId, issueTitle,
      role, level, model, sessionAction, sessionKey,
      fromLabel, toLabel,
    }).catch(() => { });

    const announcement = buildAnnouncement(level, role, sessionAction, issueId, issueTitle, issueUrl, resolvedRole, botName);

    return { sessionAction, sessionKey, level, model, announcement, deliveryStatus, deliveryId: plan.deliveryId };
  } catch (error) {
    if (!taskDispatched) {
      if (providerTransitioned) {
        try {
          await provider.transitionLabel(issueId, toLabel, fromLabel);
        } catch (rollbackError) {
          await auditLog(workspaceDir, WORKER_AUDIT_EVENT.WARNING, {
            step: "restoreProviderLabel",
            issue: issueId,
            role,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          }).catch(() => { });
        }
      }

      try {
        await releaseDispatchSlot(opts, plan);
      } catch (rollbackError) {
        await auditLog(workspaceDir, WORKER_AUDIT_EVENT.WARNING, {
          step: "releaseWorkerReservation",
          issue: issueId,
          role,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        }).catch(() => { });
      }
    }

    throw error;
  }
}
