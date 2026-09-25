/**
 * Coordinates atomic worker reservation, provider transition, session dispatch, and runtime persistence.
 * This application capability owns the dispatch use case while state retains worker-slot authority.
 */
import { log as auditLog } from "../../audit.js";
import { emptySlot, ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import {
  hasReviewCheck,
  hasTestPhase,
  isFeedbackState,
  producesReviewableWork,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../domain/index.js";
import { ensureSessionFireAndForget, sendToAgent, shouldClearSession } from "../../integrations/openclaw/session.js";
import { slotName } from "../../names.js";
import { resolveModel } from "../../roles/index.js";
import { loadConfig, loadRoleInstructions } from "../../state/index.js";
import { readIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { activateWorker, deactivateWorker, getRoleWorker } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { getNotificationConfig, notify } from "../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../notifications/resolve-endpoint.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import { acknowledgeComments, EYES_EMOJI } from "../review/acknowledge-comments.js";
import { fetchPrContext, fetchPrFeedback } from "../review/pr-context.js";
import { formatAttachmentsForTask } from "../tasks/attachments.js";
import { buildAnnouncement, buildConflictFixMessage, buildTaskMessage, formatSessionLabel } from "../tasks/message-builder.js";
import type { DispatchOpts, DispatchResult } from "./types.js";

/** Values persisted while reserving one concrete worker slot. */
type WorkerReservation = {
  /** Provider-local issue assigned to the slot. */
  issueId: number;
  /** Configured worker level containing the slot. */
  level: string;
  /** Deterministic OpenClaw session key assigned to the slot. */
  sessionKey: string;
  /** Provider label consumed by dispatch. */
  fromLabel?: string;
  /** Human-readable deterministic worker name. */
  name?: string;
};

/** Structured metadata written to successful dispatch audit events. */
type AuditDispatchOptions = {
  /** Human-readable project name. */
  project: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Current provider issue title. */
  issueTitle: string;
  /** Worker role assigned by dispatch. */
  role: string;
  /** Worker level assigned by dispatch. */
  level: string;
  /** Resolved model assigned to the session. */
  model: string;
  /** Whether the worker session was created or reused. */
  sessionAction: string;
  /** Deterministic OpenClaw worker session key. */
  sessionKey: string;
  /** Provider workflow label consumed by dispatch. */
  fromLabel: string;
  /** Provider workflow label applied by dispatch. */
  toLabel: string;
};

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
    issueDescription, issueUrl, role, level, fromLabel, toLabel,
    provider, pluginConfig, runtime,
  } = opts;

  const slotIndex = opts.slotIndex ?? 0;
  const rc = opts.runCommand;

  // ── Setup (no side effects — safe to fail) ──────────────────────────
  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const resolvedRole = resolvedConfig.roles[role];
  const { timeouts } = resolvedConfig;
  const model = resolveModel(role, level, resolvedRole);
  const roleWorker = getRoleWorker(project, role);
  const slot = roleWorker.levels[level]?.[slotIndex] ?? emptySlot();
  let existingSessionKey = slot.sessionKey;
  let sessionKeyToDelete: string | null = null;

  // Deactivated slot: preserve session if same issue is returning (feedback cycle)
  if (existingSessionKey && !slot.issueId) {
    const isSameIssueReturn = slot.lastIssueId === issueId;

    if (!isSameIssueReturn) {
      sessionKeyToDelete = existingSessionKey;
      existingSessionKey = null;
    }
  }

  // Context budget check: clear session if over budget (unless same issue — feedback cycle)
  if (existingSessionKey && timeouts.sessionContextBudget < 1) {
    const shouldClear = await shouldClearSession(existingSessionKey, slot.issueId, issueId, timeouts, workspaceDir, project.name, rc);

    if (shouldClear) {
      sessionKeyToDelete = existingSessionKey;
      existingSessionKey = null;
    }
  }

  // Compute session key deterministically (avoids waiting for gateway)
  // Slot name provides both collision prevention and human-readable identity
  const botName = slotName(project.name, role, level, slotIndex);
  const sessionKey = `agent:${agentId ?? "unknown"}:subagent:${project.slug}-${role}-${level}-${botName.toLowerCase()}`;

  // Clear stale session key if it doesn't match the current deterministic key
  // so a differently addressed gateway session cannot be reused.
  if (existingSessionKey && existingSessionKey !== sessionKey) {
    sessionKeyToDelete = existingSessionKey;
    existingSessionKey = null;
  }

  const sessionAction = existingSessionKey ? "send" : "spawn";

  // Fetch comments to include in task context
  const comments = await provider.listComments(issueId);

  // Fetch PR context based on workflow role semantics (no hardcoded role/label checks)
  const { workflow } = resolvedConfig;
  const prFeedback = isFeedbackState(workflow, fromLabel)
    ? await fetchPrFeedback(provider, issueId) : undefined;
  const prContext = hasReviewCheck(workflow, role)
    ? await fetchPrContext(provider, issueId) : undefined;

  // Fetch attachment context (best-effort — never blocks dispatch)
  let attachmentContext: string | undefined;

  try {
    attachmentContext = await formatAttachmentsForTask(workspaceDir, project.slug, issueId) || undefined;
  } catch { /* best-effort */ }

  const primaryChannelId = project.channels[0]?.channelId ?? project.slug;
  const isConflictFix = prFeedback?.reason === "merge_conflict";
  const taskMessage = isConflictFix && prFeedback
    ? buildConflictFixMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      resolvedRole, prFeedback,
    })
    : buildTaskMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueDescription, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      comments, resolvedRole, prContext, prFeedback, attachmentContext,
    });

  // Load role-specific instructions to inject into the worker's system prompt
  const roleInstructions = await loadRoleInstructions(workspaceDir, project.slug, role);

  await recordWorkerState(workspaceDir, project.slug, role, slotIndex, {
    issueId, level, sessionKey, fromLabel, name: botName,
  });
  let taskDispatched = false;
  let providerTransitioned = false;

  try {
    if (sessionKeyToDelete) {
      await rc(
        ["openclaw", "gateway", "call", "sessions.delete", "--params", JSON.stringify({ key: sessionKeyToDelete })],
        { timeoutMs: 10_000 },
      ).catch(() => { });
    }

    // ── Provider transition — compensated if agent send does not begin ──
    await provider.transitionLabel(issueId, fromLabel, toLabel);
    providerTransitioned = true;

    // Mark issue + PR as managed and all consumed comments as seen (fire-and-forget)
    provider.reactToIssue(issueId, EYES_EMOJI).catch(() => { });
    provider.reactToPr(issueId, EYES_EMOJI).catch(() => { });
    acknowledgeComments(provider, issueId, comments, prFeedback, workspaceDir).catch((err) => {
      auditLog(workspaceDir, "dispatch_warning", {
        step: "acknowledgeComments",
        issue: issueId,
        error: errorMessage(err),
      }).catch(() => { });
    });

    const issue = await provider.getIssue(issueId);
    const reviewPolicyForState = producesReviewableWork(workflow, role)
      ? workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN
      : null;
    const testPolicyForState = hasTestPhase(workflow)
      ? workflow.testPolicy ?? TEST_POLICY.SKIP
      : null;
    const issueStore = await readIssueStateStore(workspaceDir, project.slug);
    const currentState = issueStore.issues[String(issueId)];
    const ownerForState = currentState?.owner ?? opts.instanceName ?? null;

    // Step 2: Send notification early (before session dispatch which can timeout)
    // This ensures users see the notification even if gateway is slow
    const notifyConfig = getNotificationConfig(pluginConfig);
    const notifyTarget = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);

    notify(
      {
        type: "workerStart",
        project: project.name,
        issueId,
        issueTitle,
        issueUrl,
        role,
        level,
        name: botName,
        sessionAction,
      },
      {
        workspaceDir,
        config: notifyConfig,
        channelId: notifyTarget?.channelId,
        channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
        threadId: notifyTarget?.threadId,
        runtime,
        accountId: notifyTarget?.accountId,
        agentId: project.agentId,
        runCommand: rc,
      },
    ).catch((err) => {
      auditLog(workspaceDir, "dispatch_warning", {
        step: "notify", issue: issueId, role,
        error: errorMessage(err),
      }).catch(() => { });
    });

    // Step 3: Ensure session exists (fire-and-forget — don't wait for gateway)
    // Session key is deterministic, so we can proceed immediately
    const sessionLabel = formatSessionLabel(project.name, role, level, botName);

    ensureSessionFireAndForget(sessionKey, model, workspaceDir, rc, timeouts.sessionPatchMs, sessionLabel);

    // Step 4: Send task to agent (fire-and-forget)
    // Model is set on the session via sessions.patch (step 3), not on the agent RPC —
    // the gateway's agent endpoint rejects unknown properties like 'model'.
    sendToAgent(sessionKey, taskMessage, {
      agentId, projectName: project.name, issueId, role, level, slotIndex, fromLabel,
      orchestratorSessionKey: opts.sessionKey, workspaceDir,
      dispatchTimeoutMs: timeouts.dispatchMs,
      extraSystemPrompt: roleInstructions.trim() || undefined,
      runCommand: rc,
    });
    taskDispatched = true;

    // Step 5: Update worker state
    try {
      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue: {
          iid: issueId,
          labels: issue.labels
            .filter((label) => label !== fromLabel && !label.startsWith(`${role}:`))
            .concat(toLabel, `${role}:${level}`),
        },
        providerType: project.provider === ISSUE_PROVIDER.GITHUB
          ? ISSUE_PROVIDER.GITHUB
          : ISSUE_PROVIDER.GITLAB,
        workflow,
        workflowLabel: toLabel,
        assignedRole: role,
        assignedLevel: level,
        owner: ownerForState,
        reviewPolicy: reviewPolicyForState,
        testPolicy: testPolicyForState,
        activeWorker: {
          role,
          level,
          slotIndex,
          sessionKey,
          startedAt: new Date().toISOString(),
        },
      });
      await reconcileManagedLabelsLocked({
        workspaceDir,
        projectSlug: project.slug,
        issueId,
        workflow,
        roles: Object.keys(resolvedConfig.roles),
        provider,
        owner: "worker_dispatch",
      });
    } catch (err) {
      // Session is already dispatched — log warning but don't fail
      await auditLog(workspaceDir, "dispatch", {
        project: project.name, issue: issueId, role,
        warning: "State update failed after successful dispatch",
        error: errorMessage(err), sessionKey,
      });
    }

    // Step 6: Audit
    await auditDispatch(workspaceDir, {
      project: project.name, issueId, issueTitle,
      role, level, model, sessionAction, sessionKey,
      fromLabel, toLabel,
    });

    const announcement = buildAnnouncement(level, role, sessionAction, issueId, issueTitle, issueUrl, resolvedRole, botName);

    return { sessionAction, sessionKey, level, model, announcement };
  } catch (error) {
    if (!taskDispatched) {
      if (providerTransitioned) {
        try {
          await provider.transitionLabel(issueId, toLabel, fromLabel);
        } catch (rollbackError) {
          await auditLog(workspaceDir, "dispatch_warning", {
            step: "restoreProviderLabel",
            issue: issueId,
            role,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          }).catch(() => { });
        }
      }

      try {
        await deactivateWorker(workspaceDir, project.slug, role, { level, slotIndex, issueId });
      } catch (rollbackError) {
        await auditLog(workspaceDir, "dispatch_warning", {
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

/**
 * Reserve one concrete worker slot before provider and gateway dispatch side effects begin.
 *
 * @param workspaceDir - Workspace containing the authoritative project registry.
 * @param slug - Canonical project slug whose worker slot is reserved.
 * @param role - Configured role receiving the issue.
 * @param slotIndex - Concrete slot selected from a fresh queue snapshot.
 * @param opts - Worker identity and session values persisted in the reservation.
 */
async function recordWorkerState(
  workspaceDir: string, slug: string, role: string, slotIndex: number,
  opts: WorkerReservation,
): Promise<void> {
  await activateWorker(workspaceDir, slug, role, {
    issueId: opts.issueId,
    level: opts.level,
    sessionKey: opts.sessionKey,
    startTime: new Date().toISOString(),
    previousLabel: opts.fromLabel,
    slotIndex,
    name: opts.name,
  });
}

/**
 * Record dispatch identity and model selection after the worker receives its task.
 *
 * @param workspaceDir - Workspace whose audit log receives the events.
 * @param opts - Complete dispatch metadata persisted for diagnostics.
 */
async function auditDispatch(workspaceDir: string, opts: AuditDispatchOptions): Promise<void> {
  await auditLog(workspaceDir, "dispatch", {
    project: opts.project,
    issue: opts.issueId, issueTitle: opts.issueTitle,
    role: opts.role, level: opts.level,
    sessionAction: opts.sessionAction, sessionKey: opts.sessionKey,
    labelTransition: `${opts.fromLabel} → ${opts.toLabel}`,
  });
  await auditLog(workspaceDir, "model_selection", {
    issue: opts.issueId, role: opts.role, level: opts.level, model: opts.model,
  });
}

/**
 * Convert an unknown dispatch failure into a stable audit message.
 *
 * @param error - Unknown value caught from a provider, state, or gateway operation.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
