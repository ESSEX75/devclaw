/** Read-only worker diagnosis; no audit, session submission, or state mutation occurs here. */

import { DEFAULT_WORKFLOW, getActiveLabel, getCurrentStateLabel, getRevertLabel, hasWorkflowStates, WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import { isSessionAlive } from "../../../integrations/openclaw/gateway-sessions.js";
import { getRoleWorker, readIssueStateStore } from "../../../state/index.js";
import { GRACE_PERIOD_MS, HEALTH_ACTION, HEALTH_ISSUE_SEVERITY, HEALTH_ISSUE_TYPE, STALL_CONTEXT_THRESHOLD } from "./const.js";
import { fetchIssue } from "./issue-utils.js";
import type { HealthAction, HealthFix, HealthIssueSeverity, HealthIssueType, WorkerHealthInput } from "./types.js";

/** Observe each slot and propose at most one action in existing health-priority order.
 * @param input - Project, workflow, and provider observations for this pass.
 */
export async function diagnoseWorkerHealth(input: WorkerHealthInput): Promise<HealthFix[]> {
  const { workspaceDir, projectSlug, project, role, provider, sessions } = input;
  const workflow = input.workflow ?? DEFAULT_WORKFLOW;
  const states = (await readIssueStateStore(workspaceDir, projectSlug)).issues;
  const roleWorker = getRoleWorker(project, role);
  const hasStates = hasWorkflowStates(workflow, role);
  const expectedLabel = hasStates ? getActiveLabel(workflow, role) : undefined;
  const queueLabel = hasStates ? getRevertLabel(workflow, role) : undefined;
  const findings: HealthFix[] = [];

  for (const [level, slots] of Object.entries(roleWorker.levels)) {
    for (const [slotIndex, slot] of (slots ?? []).entries()) {
      const local = slot.issueId ? states[String(slot.issueId)] : undefined;
      const delivery = slot.delivery ?? local?.activeWorker?.delivery;
      const identity = {
        project: project.name, projectSlug, role, level, slotIndex,
        issueId: slot.issueId, sessionKey: slot.sessionKey,
      };

      if (slot.active && slot.issueId && delivery) {
        findings.push({ issue: {
          ...identity, type: HEALTH_ISSUE_TYPE.DELIVERY_UNKNOWN,
          severity: delivery.status === WORKER_DELIVERY_STATUS.NEEDS_ATTENTION ? HEALTH_ISSUE_SEVERITY.CRITICAL : HEALTH_ISSUE_SEVERITY.WARNING,
          message: `${role} ${level}[${slotIndex}] delivery ${delivery.status}; inspect the run before retry`,
        }, fixed: false, plannedAction: HEALTH_ACTION.RECONCILE_DELIVERY });
        continue;
      }

      if (slot.issueId && !local) {
        findings.push({ issue: {
          ...identity, type: HEALTH_ISSUE_TYPE.ISSUE_STATE_MISSING,
          severity: HEALTH_ISSUE_SEVERITY.CRITICAL,
          message: `${role} ${level}[${slotIndex}] references issue #${slot.issueId} without local runtime state`,
        }, fixed: false });
        continue;
      }

      if (!expectedLabel || !queueLabel) continue;
      const issue = slot.issueId ? await fetchIssue(provider, slot.issueId) : null;
      const providerLabel = issue ? getCurrentStateLabel(issue.labels, workflow) : null;
      // Provider label edits do not become authoritative workflow transitions.
      const currentLabel = local?.workflowLabel;
      const session = slot.sessionKey ? sessions?.sessions.get(slot.sessionKey) : undefined;
      const alive = slot.sessionKey ? isSessionAlive(slot.sessionKey, sessions) : false;
      const ageMs = slot.startTime ? Date.now() - new Date(slot.startTime).getTime() : 0;
      const inGrace = !!slot.startTime && ageMs < GRACE_PERIOD_MS;
      let type: HealthIssueType | undefined;
      let action: HealthAction | undefined;
      let severity: HealthIssueSeverity = HEALTH_ISSUE_SEVERITY.CRITICAL;

      if (slot.active && issue && currentLabel !== expectedLabel) { type = HEALTH_ISSUE_TYPE.LABEL_MISMATCH; action = HEALTH_ACTION.RELEASE; }
      else if (slot.active && (!slot.sessionKey || (!inGrace && alive === false))) { type = HEALTH_ISSUE_TYPE.SESSION_DEAD; action = HEALTH_ACTION.REQUEUE; }
      else if (slot.active && alive && session?.abortedLastRun) { type = HEALTH_ISSUE_TYPE.CONTEXT_OVERFLOW; action = HEALTH_ACTION.REQUEUE; }
      else if (slot.active && alive && session && session.updatedAt > 0 && !inGrace
        && Date.now() - session.updatedAt > (input.stallTimeoutMinutes ?? 15) * 60_000) {
        type = HEALTH_ISSUE_TYPE.SESSION_STALLED;
        action = (session.contextTokens ?? 0) < STALL_CONTEXT_THRESHOLD ? HEALTH_ACTION.REQUEUE : HEALTH_ACTION.NUDGE;
      } else if (slot.active && alive && slot.startTime && ageMs > (input.staleWorkerHours ?? 2) * 3_600_000) {
        type = HEALTH_ISSUE_TYPE.STALE_WORKER; action = HEALTH_ACTION.REQUEUE; severity = HEALTH_ISSUE_SEVERITY.WARNING;
      } else if (!slot.active && issue && currentLabel === expectedLabel) { type = HEALTH_ISSUE_TYPE.STUCK_LABEL; action = HEALTH_ACTION.REQUEUE; }
      else if (!slot.active && slot.issueId) { type = HEALTH_ISSUE_TYPE.ORPHAN_ISSUE_ID; action = HEALTH_ACTION.CLEAR_REFERENCE; severity = HEALTH_ISSUE_SEVERITY.WARNING; }
      else if (slot.active && issue && local && providerLabel !== local.workflowLabel) { type = HEALTH_ISSUE_TYPE.LABEL_MISMATCH; action = HEALTH_ACTION.RECONCILE_PROJECTION; }

      if (type && action) findings.push({
        issue: {
          ...identity, type, severity, expectedLabel, actualLabel: providerLabel,
          hoursActive: Math.round(ageMs / 360_000) / 10,
          message: `${role.toUpperCase()} ${level}[${slotIndex}] issue #${slot.issueId}: ${type}; planned ${action}`,
        },
        fixed: false, plannedAction: action,
      });
    }
  }

  return findings;
}
