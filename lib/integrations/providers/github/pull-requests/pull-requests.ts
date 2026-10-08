/** Owns GitHub pull-requests operations and their provider-specific API semantics. */

import type { PrState, PrStatus } from "../../contracts/index.js";
import { PR_STATE, PROVIDER_REVIEW_STATE } from "../../contracts/index.js";
import { classifyProviderLookupFailure, PROVIDER_ISSUE_LOOKUP_ERROR, ProviderIssueLookupError } from "../../errors/index.js";
import { hasIssueCommitOnBaseBranch } from "../../git/index.js";
import type { ProviderTransport } from "../../transport/index.js";
import { GITHUB_API_RESOURCE, GITHUB_REQUEST_STATE, githubApiPath } from "../api/index.js";
import { GhInlineSchema } from "../comments/index.js";
import { GITHUB_DISCOVERY_STATE, GitHubDiscovery } from "../discovery/index.js";
import { GITHUB_REVIEW_BOT_SUFFIX,GitHubReviews, latestFormalReviews } from "../reviews/index.js";
import { GITHUB_MERGEABILITY } from "./const.js";

/** Implements the pull-requests capability using dependencies shared by one adapter instance. */
export class GitHubPullRequests {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param discovery - Shared discovery capability for this adapter.
   * @param reviews - Shared reviews capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly discovery: GitHubDiscovery, private readonly reviews: GitHubReviews) {}

  /** Return the newest confirmed merged request URL after complete discovery.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  async getMergedMRUrl(issueId: number): Promise<string | null> {
    const prs = await this.discovery.findPrsForIssue(issueId, GITHUB_DISCOVERY_STATE.MERGED);

    if (prs.length === 0) return null;

    return prs[0].url;
  }

  /** Observe PR state; missing PRs require successful lookup and failed reads remain typed errors.
   * @param issueId - Managed issue whose associated PR state is observed.
   * @param prUrl - Optional exact request URL supplied by prior application evidence.
   */
  async getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    const found = await this.discovery.findPrsForIssue(issueId, GITHUB_DISCOVERY_STATE.ALL);
    const candidates = prUrl ? found.filter(pr => pr.url === prUrl) : found;

    if (prUrl && !candidates.length) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "github",
      retryable: false, message: `Previously selected PR is no longer associated with this issue: ${prUrl}` });
    const open = candidates.find(pr => pr.state === GITHUB_REQUEST_STATE.OPEN);

    if (open) {
      const reviews = await this.reviews.readReviews(open.number);
      const summaries = reviews.filter(review => review.state === PROVIDER_REVIEW_STATE.COMMENTED && review.body.trim().length > 0);
      const conversations = await this.reviews.fetchConversationComments(open.number);
      const inlines = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.PULLS, open.number, GITHUB_API_RESOURCE.COMMENTS), GhInlineSchema);
      const hasCommentFeedback = conversations.some(comment => (comment.reactions?.eyes ?? 0) === 0)
        || inlines.some(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX) && comment.body.trim().length > 0 && (comment.reactions?.eyes ?? 0) === 0);
      const decisions = latestFormalReviews(reviews);
      let state: PrState;

      if (open.reviewDecision === PROVIDER_REVIEW_STATE.CHANGES_REQUESTED
        || decisions.some(review => review.state === PROVIDER_REVIEW_STATE.CHANGES_REQUESTED)) state = PR_STATE.CHANGES_REQUESTED;
      else if (open.reviewDecision === PROVIDER_REVIEW_STATE.APPROVED
        || decisions.some(review => review.state === PROVIDER_REVIEW_STATE.APPROVED)) state = PR_STATE.APPROVED;
      else state = hasCommentFeedback || summaries.length ? PR_STATE.HAS_COMMENTS : PR_STATE.OPEN;
      const mergeable = open.mergeable === GITHUB_MERGEABILITY.CONFLICTING ? false : open.mergeable === GITHUB_MERGEABILITY.MERGEABLE ? true : undefined;

      return { state, url: open.url, title: open.title, sourceBranch: open.headRefName, mergeable,
        reviewSummaries: summaries, hasCommentFeedback };
    }

    const merged = candidates.find(pr => pr.state === GITHUB_REQUEST_STATE.MERGED);

    if (merged) return { state: PR_STATE.MERGED, url: merged.url, title: merged.title, sourceBranch: merged.headRefName };
    const closed = candidates.find(pr => pr.state === GITHUB_REQUEST_STATE.CLOSED);

    return closed ? { state: PR_STATE.CLOSED, url: closed.url, title: closed.title, sourceBranch: closed.headRefName } : { state: PR_STATE.CLOSED, url: null };
  }

  /** Merge one exact observed PR, never redirecting to another open candidate.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact URL supplied by prior application evidence.
   */
  async mergePr(issueId: number, prUrl?: string): Promise<void> {
    const pr = await this.discovery.selectOpenPr(issueId, prUrl);

    if (!pr) throw new Error(`No open PR found for issue #${issueId}`);
    await this.transport.once(["pr", "merge", pr.url, "--merge"]);
  }

  /** Read the same selected PR's diff; failed explicit selection cannot yield another request's content.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact URL supplied by prior application evidence.
   */
  async getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    const pr = await this.discovery.selectOpenPr(issueId, prUrl);

    if (!pr) return null;
    try {
      return await this.transport.read(["pr", "diff", String(pr.number)]);
    } catch (error) { throw classifyProviderLookupFailure("github", error); }
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference without a numeric-prefix match.
   * Used as a fallback when no PR exists (e.g., direct commit to main).
   * @param issueId - Positive issue identifier to match exactly.
   * @param baseBranch - Configured base branch whose history is inspected.
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      return await hasIssueCommitOnBaseBranch(this.transport.runCommand, this.transport.repoPath, issueId, baseBranch);
    } catch (error) { throw classifyProviderLookupFailure("github", error); }
  }
}
