/** Read-only worker diagnosis; no audit, session submission, or state mutation occurs here. */
import { DEFAULT_WORKFLOW, getActiveLabel, getCurrentStateLabel, getRevertLabel, hasWorkflowStates, WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import { getRoleWorker, readIssueStateStore } from "../../../state/index.js";
import { GRACE_PERIOD_MS, HEALTH_ACTION, STALL_CONTEXT_THRESHOLD } from "./const.js";
import { isSessionAlive } from "./gateway-sessions.js";
import { fetchIssue, isIssueClosed } from "./issue-utils.js";
import type { HealthAction, HealthFix, HealthIssue, WorkerHealthInput } from "./types.js";

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
          ...identity, type: "delivery_unknown",
          severity: delivery.status === WORKER_DELIVERY_STATUS.NEEDS_ATTENTION ? "critical" : "warning",
          message: `${role} ${level}[${slotIndex}] delivery ${delivery.status}; inspect the run before retry`,
        }, fixed: false, plannedAction: HEALTH_ACTION.RECONCILE_DELIVERY });
        continue;
      }

      if (!expectedLabel || !queueLabel) continue;
      const issue = slot.issueId ? await fetchIssue(provider, slot.issueId) : null;
      const providerLabel = issue ? getCurrentStateLabel(issue.labels, workflow) : null;
      // Provider label edits do not become authoritative workflow transitions.
      const currentLabel = local?.workflowLabel ?? providerLabel;
      const session = slot.sessionKey ? sessions?.get(slot.sessionKey) : undefined;
      const alive = !!slot.sessionKey && !!sessions && isSessionAlive(slot.sessionKey, sessions);
      const ageMs = slot.startTime ? Date.now() - new Date(slot.startTime).getTime() : 0;
      const inGrace = !!slot.startTime && ageMs < GRACE_PERIOD_MS;
      let type: HealthIssue["type"] | undefined;
      let action: HealthAction | undefined;
      let severity: HealthIssue["severity"] = "critical";

      if (slot.active && slot.issueId && !issue) { type = "issue_gone"; action = HEALTH_ACTION.RELEASE; }
      else if (slot.active && issue && isIssueClosed(issue)) { type = "issue_closed"; action = HEALTH_ACTION.RELEASE; }
      else if (slot.active && issue && currentLabel !== expectedLabel) { type = "label_mismatch"; action = HEALTH_ACTION.RELEASE; }
      else if (slot.active && (!slot.sessionKey || (sessions && !inGrace && !alive))) { type = "session_dead"; action = HEALTH_ACTION.REQUEUE; }
      else if (slot.active && alive && session?.abortedLastRun) { type = "context_overflow"; action = HEALTH_ACTION.REQUEUE; }
      else if (slot.active && alive && session && !inGrace && Date.now() - (session.updatedAt || 0) > (input.stallTimeoutMinutes ?? 15) * 60_000) {
        type = "session_stalled";
        action = (session.contextTokens ?? 0) < STALL_CONTEXT_THRESHOLD ? HEALTH_ACTION.REQUEUE : HEALTH_ACTION.NUDGE;
      } else if (slot.active && alive && slot.startTime && ageMs > (input.staleWorkerHours ?? 2) * 3_600_000) {
        type = "stale_worker"; action = HEALTH_ACTION.REQUEUE; severity = "warning";
      } else if (!slot.active && issue && currentLabel === expectedLabel) { type = "stuck_label"; action = HEALTH_ACTION.REQUEUE; }
      else if (!slot.active && slot.issueId) { type = "orphan_issue_id"; action = HEALTH_ACTION.CLEAR_REFERENCE; severity = "warning"; }
      else if (slot.active && issue && local && providerLabel !== local.workflowLabel) { type = "label_mismatch"; action = HEALTH_ACTION.RECONCILE_PROJECTION; }

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
