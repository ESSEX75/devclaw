/** Filters and persists delivered review-summary evidence in the authoritative local issue record. */

import { createHash } from "node:crypto";

import type { ReviewSummaryReceipt } from "../../domain/index.js";
import { PR_COMMENT_KIND, PROVIDER_REVIEW_STATE, PrState, type PrStatus } from "../../integrations/providers/index.js";
import { readIssueStateStore, updateIssueRuntimeRecord } from "../../state/index.js";
import { REVIEW_SUMMARY_HASH_ALGORITHM } from "./const.js";
import type { FeedbackProvider, PrFeedback, ReviewIssueContext } from "./types.js";

/** Hash exactly the summary content supplied to the worker, keeping edited observations actionable.
 * @param comment - Full provider summary retained in selected worker context.
 */
function summaryFingerprint(comment: PrFeedback["comments"][number]): string {
  return createHash(REVIEW_SUMMARY_HASH_ALGORITHM)
    .update(JSON.stringify([comment.author, comment.body, comment.state, comment.path ?? null, comment.line ?? null])).digest("hex");
}

/** Capture only full summaries included in selected worker context.
 * @param feedback - Selected context, absent when the turn contains no review feedback.
 */
export function buildReviewSummaryReceipts(feedback?: PrFeedback): ReviewSummaryReceipt[] {
  return (feedback?.comments ?? []).filter(comment => comment.kind === PR_COMMENT_KIND.REVIEW && comment.state === PROVIDER_REVIEW_STATE.COMMENTED)
    .map(comment => ({ prUrl: feedback?.url ?? "", reviewId: comment.id, fingerprint: summaryFingerprint(comment) }));
}

/** Merge fresh accepted evidence without dropping concurrently acknowledged summary identities.
 * @param current - Receipts from the latest locked issue snapshot.
 * @param added - Full summaries whose delivery has been explicitly confirmed.
 */
export function mergeReviewSummaryReceipts(current: readonly ReviewSummaryReceipt[], added: readonly ReviewSummaryReceipt[]): ReviewSummaryReceipt[] {
  const receipts = [...current];

  for (const receipt of added) {
    const index = receipts.findIndex(existing => existing.prUrl === receipt.prUrl && existing.reviewId === receipt.reviewId);

    if (index >= 0) receipts[index] = receipt;
    else receipts.push(receipt);
  }

  return receipts;
}

/** Retain only summaries not already delivered with the same PR identity and full content.
 * @param context - Exact local project/workspace identity.
 * @param issueId - Initialized managed issue whose receipts are read.
 * @param feedback - Provider observations to compare without mutating them.
 */
export async function filterProcessedReviewSummaries(context: ReviewIssueContext, issueId: number, feedback: PrFeedback): Promise<PrFeedback> {
  const state = (await readIssueStateStore(context.workspaceDir, context.projectSlug)).issues[String(issueId)];
  const receipts = state?.processedReviewSummaries ?? [];

  return { ...feedback, comments: feedback.comments.filter(comment => comment.kind !== PR_COMMENT_KIND.REVIEW || comment.state !== PROVIDER_REVIEW_STATE.COMMENTED
    || !receipts.some(receipt => receipt.prUrl === feedback.url && receipt.reviewId === comment.id && receipt.fingerprint === summaryFingerprint(comment))) };
}

/** Record full summaries only after a worker turn was confirmed accepted; never initializes missing issue state.
 * Fresh locked updates preserve concurrent receipts and all workflow/worker ownership fields.
 * @param context - Exact local project/workspace identity.
 * @param issueId - Managed issue whose accepted context is acknowledged.
 * @param feedback - Full feedback actually included in the accepted worker message.
 */
export async function recordProcessedReviewSummaries(context: ReviewIssueContext, issueId: number, feedback: PrFeedback): Promise<void> {
  const receipts = buildReviewSummaryReceipts(feedback);

  if (!receipts.length) return;
  await updateIssueRuntimeRecord(context.workspaceDir, context.projectSlug, issueId, previous => {
    if (!previous) throw new Error("Cannot acknowledge review summaries for an uninitialized issue.");

    return { ...previous, processedReviewSummaries: mergeReviewSummaryReceipts(previous.processedReviewSummaries ?? [], receipts) };
  });
}

/** Interpret summary-only feedback using local accepted-turn receipts, never provider reaction counts.
 * Formal changes requested and other feedback remain actionable independently of these receipts.
 * @param provider - Provider status capability containing summary observations.
 * @param issueId - Initialized managed issue being observed.
 * @param context - Exact local owner of the receipt evidence.
 */
export async function observePrStatusWithReceipts(provider: Pick<FeedbackProvider, "getPrStatus">,
  issueId: number, context: ReviewIssueContext): Promise<PrStatus> {
  const status = await provider.getPrStatus(issueId);

  if (status.state !== PrState.HAS_COMMENTS || !status.url || !status.reviewSummaries || status.hasCommentFeedback !== false) return status;
  const remaining = await filterProcessedReviewSummaries(context, issueId, { url: status.url, comments: status.reviewSummaries });

  return remaining.comments.length ? status : { ...status, state: PrState.OPEN };
}
