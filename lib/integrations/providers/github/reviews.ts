/** Owns GitHub reviews operations and their provider-specific API semantics. */

import type { PrReviewComment } from "../contracts/index.js";
import { PR_COMMENT_KIND, PROVIDER_FEEDBACK_STATE, PROVIDER_REVIEW_STATE } from "../contracts/index.js";
import { latestFormalReviews } from "../review-observations.js";
import type { ProviderTransport } from "../transport/index.js";
import { GITHUB_API_RESOURCE, GITHUB_REVIEW_BOT_SUFFIX } from "./const.js";
import { GitHubDiscovery } from "./discovery.js";
import { githubApiPath } from "./endpoints.js";
import { GhCommentSchema, GhInlineSchema, GhReviewSchema } from "./schema.js";
import type { GhConversationComment } from "./types.js";

/** Implements the reviews capability using dependencies shared by one adapter instance. */
export class GitHubReviews {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param discovery - Shared discovery capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly discovery: GitHubDiscovery) {}

  /** Read complete review summaries while keeping their reaction-free source identity.
   * @param prNumber - Exact selected pull request.
   */
  async readReviews(prNumber: number): Promise<PrReviewComment[]> {
    const reviews = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.PULLS, prNumber, GITHUB_API_RESOURCE.REVIEWS), GhReviewSchema);

    return reviews.filter(review => review.submitted_at !== null && !review.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX)).map(review => ({ kind: PR_COMMENT_KIND.REVIEW,
      id: review.id, author: review.user.login, body: review.body, state: review.state, created_at: review.submitted_at ?? "" }));
  }

  /** Read complete human PR conversations; author comments remain eligible.
   * @param prNumber - Exact selected pull request.
   */
  async fetchConversationComments(prNumber: number): Promise<GhConversationComment[]> {
    const comments = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.ISSUES, prNumber, GITHUB_API_RESOURCE.COMMENTS), GhCommentSchema);

    return comments.filter(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX) && comment.body.trim().length > 0);
  }

  /** Read every feedback source for the same deterministically selected open PR.
   * @param issueId - Managed issue whose full PR feedback is requested.
   * @param prUrl - Exact observed request to read, when supplied.
   */
  async getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    const pr = await this.discovery.selectOpenPr(issueId, prUrl);

    if (!pr) return [];
    const prNumber = pr.number;
    const reviews = await this.readReviews(prNumber);
    const comments = [
      ...reviews.filter(review => review.state === PROVIDER_REVIEW_STATE.COMMENTED && review.body.trim().length > 0),
      ...latestFormalReviews(reviews).filter(review => review.state !== PROVIDER_REVIEW_STATE.DISMISSED),
    ];
    const inlines = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.PULLS, prNumber, GITHUB_API_RESOURCE.COMMENTS), GhInlineSchema);

    for (const comment of inlines.filter(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX))) {
      comments.push({ kind: PR_COMMENT_KIND.INLINE, id: comment.id, author: comment.user.login, body: comment.body,
        state: PROVIDER_FEEDBACK_STATE.INLINE, created_at: comment.created_at, path: comment.path, line: comment.line ?? undefined });
    }

    for (const comment of await this.fetchConversationComments(prNumber)) {
      comments.push({ kind: PR_COMMENT_KIND.CONVERSATION, id: comment.id, author: comment.user.login,
        body: comment.body, state: PROVIDER_REVIEW_STATE.COMMENTED, created_at: comment.created_at });
    }

    return comments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  }
}
