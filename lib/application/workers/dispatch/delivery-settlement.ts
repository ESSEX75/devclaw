/** Fences late gateway callbacks against operator decisions and reused worker sessions. */

import { AGENT_TURN_STATUS } from "../../../integrations/openclaw/const.js";
import type { AgentTurnOutcome } from "../../../integrations/openclaw/types.js";
import { readIssueStateStore, readProjects, readWorkerDeliveryResolution, withIssueOrchestrationLock } from "../../../state/index.js";
import { acknowledgeComments, EYES_EMOJI } from "../../review/index.js";
import { reconcileUncertainDispatch } from "../delivery-recovery/index.js";
import { recordIssueDelivery, recordSlotDelivery } from "../delivery-state.js";
import type { DispatchAttempt, DispatchContext, DispatchOpts } from "./types.js";

/** Settle only the same unresolved submission, serialized with explicit operator recovery.
 * @param opts - Original dispatch capabilities and issue identity.
 * @param plan - Original concrete submission token.
 * @param context - Context acknowledged only if that submission remains current.
 * @param outcome - Late gateway command outcome.
 */
export async function settleDispatchDelivery(opts: DispatchOpts, plan: DispatchAttempt, context: DispatchContext, outcome: AgentTurnOutcome): Promise<void> {
  const { workspaceDir, project, issueId, provider, runCommand } = opts;
  const { role, level, slotIndex, sessionKey, deliveryId } = plan;

  await withIssueOrchestrationLock(workspaceDir, project.slug, issueId, async () => {
    const resolved = await readWorkerDeliveryResolution(workspaceDir, project.slug, issueId);
    const current = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];

    const projectNow = (await readProjects(workspaceDir)).projects[project.slug];
    const slot = projectNow?.workers[role]?.levels[level]?.[slotIndex];

    if (slot?.delivery?.operationId !== deliveryId || slot.issueId !== issueId || slot.sessionKey !== sessionKey) return;
    if (resolved?.deliveryId === deliveryId || current?.activeWorker?.delivery?.operationId !== deliveryId) return;
    if (outcome.kind === AGENT_TURN_STATUS.ACCEPTED) {
      await recordSlotDelivery(opts.workspaceDir, opts.project.slug, opts.issueId, plan, undefined);
      await recordIssueDelivery(workspaceDir, project.slug, issueId, sessionKey, deliveryId, undefined);
      provider.reactToIssue(issueId, EYES_EMOJI).catch(() => {});
      provider.reactToPr(issueId, EYES_EMOJI).catch(() => {});
      await acknowledgeComments(provider, issueId, context.isConflictFix ? [] : context.comments, context.prFeedback, workspaceDir);
    } else {
      await reconcileUncertainDispatch({ workspaceDir, projectSlug: project.slug, role, level, slotIndex, issueId,
        sessionKey, deliveryId, runCommand, reason: outcome.reason, outcomeUnknown: true });
    }
  });
}
