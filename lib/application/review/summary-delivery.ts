/** Retains submitted summary context until acceptance, exact completion or explicit operator evidence confirms delivery. */

import type { ActiveIssueWorker } from "../../domain/index.js";
import { updateIssueRuntimeRecord } from "../../state/index.js";
import { buildReviewSummaryReceipts, mergeReviewSummaryReceipts } from "./summary-receipts.js";
import type { PrFeedback, ReviewIssueContext } from "./types.js";

/** Compare the complete captured worker frame instead of a reusable session key alone.
 * @param actual - Worker from the current local snapshot.
 * @param expected - Worker selected for the original turn or completion.
 */
function sameWorker(actual: ActiveIssueWorker | null, expected: ActiveIssueWorker): boolean {
  return actual !== null && actual.role === expected.role && actual.level === expected.level && actual.slotIndex === expected.slotIndex
    && actual.sessionKey === expected.sessionKey && actual.startedAt === expected.startedAt;
}

/** Persist submitted fingerprints without acknowledging them; clear stale pending context for summary-free turns.
 * @param context - Exact issue-store owner.
 * @param issueId - Managed issue receiving the selected worker turn.
 * @param operationId - Immutable submission identity.
 * @param worker - Captured worker frame selected by dispatch.
 * @param feedback - Full selected feedback, absent when no summary was included.
 */
export async function stageReviewSummaryDelivery(context: ReviewIssueContext, issueId: number, operationId: string,
  worker: ActiveIssueWorker, feedback?: PrFeedback): Promise<void> {
  const receipts = buildReviewSummaryReceipts(feedback);

  await updateIssueRuntimeRecord(context.workspaceDir, context.projectSlug, issueId, previous => {
    if (!previous || !sameWorker(previous.activeWorker, worker)
      || (previous.activeWorker?.delivery && previous.activeWorker.delivery.operationId !== operationId)) {
      throw new Error("Worker changed before summary context could be retained.");
    }

    return { ...previous, pendingReviewSummaryDelivery: receipts.length ? { operationId, receipts,
      worker: { role: worker.role, level: worker.level, slotIndex: worker.slotIndex, sessionKey: worker.sessionKey, startedAt: worker.startedAt },
    } : undefined };
  });
}

/** Confirm only the same persisted submission; caller supplies acceptance or explicit completion/operator evidence.
 * A missing/replaced worker or submission leaves the context unacknowledged. Workflow and ownership remain unchanged.
 * @param context - Exact issue-store owner.
 * @param issueId - Managed issue whose delivery is confirmed.
 * @param operationId - Submission proven by the caller's accepted-turn or completion evidence.
 */
export async function confirmReviewSummaryDelivery(context: ReviewIssueContext, issueId: number, operationId: string): Promise<void> {
  await updateIssueRuntimeRecord(context.workspaceDir, context.projectSlug, issueId, previous => {
    const pending = previous?.pendingReviewSummaryDelivery;

    if (!previous) throw new Error("Cannot confirm summary delivery for an uninitialized issue.");
    if (!pending || pending.operationId !== operationId || !sameWorker(previous.activeWorker, pending.worker)
      || (previous.activeWorker?.delivery && previous.activeWorker.delivery.operationId !== operationId)) return previous;

    return { ...previous, processedReviewSummaries: mergeReviewSummaryReceipts(previous.processedReviewSummaries ?? [], pending.receipts),
      pendingReviewSummaryDelivery: undefined };
  });
}
