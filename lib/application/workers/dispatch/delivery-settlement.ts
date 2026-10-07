/** Fences late gateway callbacks against operator decisions and reused worker sessions. */

import type { AgentTurnOutcome } from "../../../integrations/openclaw/sessions/index.js";
import { AGENT_TURN_STATUS } from "../../../integrations/openclaw/sessions/index.js";
import { readIssueStateStore, readProjects, readWorkerDeliveryResolution, withIssueOrchestrationLock } from "../../../state/index.js";
import { acknowledgeComments, confirmReviewSummaryDelivery, EYES_EMOJI } from "../../review/index.js";
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
      if (context.prFeedback) await confirmReviewSummaryDelivery({ workspaceDir, projectSlug: project.slug }, issueId, deliveryId);
      await recordSlotDelivery(opts.workspaceDir, opts.project.slug, opts.issueId, plan, undefined);
      await recordIssueDelivery(workspaceDir, project.slug, issueId, sessionKey, deliveryId, undefined);
      provider.reactToIssue(issueId, EYES_EMOJI).catch(() => {});
      provider.reactToPr(issueId, EYES_EMOJI).catch(() => {});
      acknowledgeComments(provider, issueId, context.isConflictFix ? [] : context.comments, context.prFeedback, workspaceDir).catch(() => {});
    } else {
      await reconcileUncertainDispatch({ workspaceDir, projectSlug: project.slug, role, level, slotIndex, issueId,
        sessionKey, deliveryId, runCommand, reason: outcome.reason, outcomeUnknown: true });
    }
  });
}
