/** Applies diagnosed worker actions after locking and re-reading ownership and issue state. */
import { log as auditLog } from "../../../audit.js";
import { DEFAULT_WORKFLOW, findStateKeyByLabel, getActiveLabel, getRevertLabel } from "../../../domain/index.js";
import { sendToAgent } from "../../../integrations/openclaw/session.js";
import {
  deactivateWorker, getProject, getRoleWorker, readIssueStateStore, readProjects,
  updateIssueRuntimeRecord, updateSlot, withIssueOrchestrationLock,
} from "../../../state/index.js";
import { commitWorkflowTransitionLocked } from "../../pipeline/transition.js";
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import { reconcileUncertainDispatch } from "../../workers/index.js";
import { HEALTH_ACTION, NUDGE_MESSAGE } from "./const.js";
import type { HealthFix, WorkerHealthInput } from "./types.js";
import { diagnoseWorkerHealth } from "./worker-diagnosis.js";

/** Revalidate a diagnosed slot; stale findings never authorize effects on a replacement run.
 * @param input - Original observation and runtime dependencies.
 * @param finding - Action proposed by read-only diagnosis.
 */
export async function remediateWorkerHealth(input: WorkerHealthInput, finding: HealthFix): Promise<HealthFix> {
  const { workspaceDir, projectSlug, role } = input;
  const { level, slotIndex, issueId } = finding.issue;

  if (level == null || slotIndex === undefined) return finding;
  const expected = getRoleWorker(input.project, role).levels[level]?.[slotIndex];

  if (!expected) return finding;
  const apply = async (): Promise<HealthFix> => {
    const project = getProject(await readProjects(workspaceDir), projectSlug);
    const slot = project ? getRoleWorker(project, role).levels[level]?.[slotIndex] : undefined;

    if (!project || !slot || slot.issueId !== expected.issueId || slot.sessionKey !== expected.sessionKey
      || slot.startTime !== expected.startTime || slot.active !== expected.active) return finding;
    const fresh = (await diagnoseWorkerHealth({ ...input, project })).find((item) =>
      item.issue.level === level && item.issue.slotIndex === slotIndex && item.issue.type === finding.issue.type
      && item.plannedAction === finding.plannedAction);

    if (!fresh) return finding;
    const workflow = input.workflow ?? DEFAULT_WORKFLOW;
    const state = issueId ? (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)] : undefined;

    if (state?.activeWorker && (state.activeWorker.sessionKey !== slot.sessionKey
      || state.activeWorker.role !== role || state.activeWorker.level !== level || state.activeWorker.slotIndex !== slotIndex)) return fresh;
    if (fresh.plannedAction === HEALTH_ACTION.RECONCILE_DELIVERY) {
      const delivery = slot.delivery ?? state?.activeWorker?.delivery;

      if (issueId && slot.sessionKey && delivery) {
        await reconcileUncertainDispatch({
          workspaceDir, projectSlug, role, level, slotIndex, issueId,
          sessionKey: slot.sessionKey, runCommand: input.runCommand, reason: delivery.reason, sessions: input.sessions,
        });
        fresh.appliedAction = HEALTH_ACTION.RECONCILE_DELIVERY;
      }

      return fresh;
    }

    if (fresh.plannedAction === HEALTH_ACTION.RECONCILE_PROJECTION) {
      if (!issueId || !state) return fresh;
      await reconcileManagedLabelsLocked({ workspaceDir, projectSlug, issueId, workflow, provider: input.provider, owner: "heartbeat_worker_health" });
    } else if (fresh.plannedAction === HEALTH_ACTION.NUDGE) {
      if (!issueId || !slot.sessionKey) return fresh;
      sendToAgent(slot.sessionKey, NUDGE_MESSAGE, {
        workspaceDir, projectName: project.name, role, level, slotIndex, issueId,
        agentId: input.agentId, runCommand: input.runCommand,
      });
      fresh.nudgeSent = true;
    } else if (fresh.plannedAction === HEALTH_ACTION.REQUEUE) {
      if (!issueId || !state) return { ...fresh, error: "Local issue state is not initialized; explicit repair is required." };
      const from = getActiveLabel(workflow, role);
      const to = slot.previousLabel ?? getRevertLabel(workflow, role);
      const toState = findStateKeyByLabel(workflow, to);

      if (!toState || state.workflowLabel !== from) return fresh;
      const committed = await commitWorkflowTransitionLocked({
        workspaceDir, project, issueId, provider: input.provider, workflow,
        plan: { from, toLabel: to, toState, actions: [] },
        issue: await input.provider.getIssue(issueId), owner: "heartbeat_worker_health", checkLocalState: true,
      });

      if (!committed) return fresh;
      await deactivateWorker(workspaceDir, projectSlug, role, { level, slotIndex, issueId });
      fresh.labelReverted = `${from} → ${to}`;
    } else if (fresh.plannedAction === HEALTH_ACTION.RELEASE || fresh.plannedAction === HEALTH_ACTION.CLEAR_REFERENCE) {
      let released = false;

      await updateSlot(workspaceDir, projectSlug, role, level, slotIndex, (current) => {
        if (current.issueId !== slot.issueId || current.sessionKey !== slot.sessionKey
          || current.startTime !== slot.startTime || current.active !== slot.active) return current;
        released = true;

        return { ...current, active: false, issueId: null, startTime: null, previousLabel: null, lastIssueId: current.issueId };
      });
      if (!released) return fresh;
      if (issueId && state?.activeWorker?.sessionKey === slot.sessionKey) {
        await updateIssueRuntimeRecord(workspaceDir, projectSlug, issueId, (previous) => {
          if (!previous) throw new Error("Issue disappeared during worker remediation.");

          return { ...previous, activeWorker: null };
        });
      }
    } else return fresh;
    fresh.fixed = true;
    fresh.appliedAction = fresh.plannedAction;
    await auditLog(workspaceDir, "worker_health_remediated", {
      projectSlug, role, level, slotIndex, issueId, finding: fresh.issue.type, action: fresh.plannedAction,
    }).catch((error: unknown) => {
      fresh.error = `Remediation completed but audit failed: ${error instanceof Error ? error.message : String(error)}`;
    });

    return fresh;
  };

  try {
    return issueId ? await withIssueOrchestrationLock(workspaceDir, projectSlug, issueId, apply) : await apply();
  } catch (error) {
    return { ...finding, error: error instanceof Error ? error.message : String(error), labelRevertFailed: finding.plannedAction === HEALTH_ACTION.REQUEUE };
  }
}
