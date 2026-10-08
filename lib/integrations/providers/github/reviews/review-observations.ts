/** Selects current formal review decisions without reviving superseded or dismissed feedback. */

import type { PrReviewComment } from "../../contracts/index.js";
import { PROVIDER_REVIEW_STATE } from "../../contracts/index.js";

/** Select the chronologically latest formal review per author, retaining dismissal as a cleared decision.
 * COMMENTED summaries never revoke a formal decision and remain independent feedback observations.
 * @param reviews - Provider observations whose timestamps have been validated at the adapter boundary.
 */
export function latestFormalReviews(reviews: readonly PrReviewComment[]): PrReviewComment[] {
  const latest = new Map<string, PrReviewComment>();

  for (const review of [...reviews].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)) {
    if (review.state === PROVIDER_REVIEW_STATE.APPROVED || review.state === PROVIDER_REVIEW_STATE.CHANGES_REQUESTED
      || review.state === PROVIDER_REVIEW_STATE.DISMISSED) latest.set(review.author, review);
  }

  return [...latest.values()];
}
