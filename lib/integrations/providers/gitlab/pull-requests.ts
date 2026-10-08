import { hasIssueCommitOnBaseBranch } from "../commit-references.js";
import type { PrState, PrStatus } from "../contracts/index.js";
/** Owns GitLab pull-requests operations and their provider-specific API semantics. */
import { PR_STATE } from "../contracts/index.js";
import { PROVIDER_ISSUE_LOOKUP_ERROR } from "../errors/index.js";
import { classifyProviderLookupFailure, ProviderIssueLookupError } from "../errors/index.js";
import type { ProviderTransport } from "../transport/index.js";
import { GITLAB_REQUEST_STATE } from "./const.js";
import { GitLabDiscovery } from "./discovery.js";
import { GitLabReviews } from "./reviews.js";

/** Implements the pull-requests capability using dependencies shared by one adapter instance. */
export class GitLabPullRequests {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param discovery - Shared discovery capability for this adapter.
   * @param reviews - Shared reviews capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly discovery: GitLabDiscovery, private readonly reviews: GitLabReviews) {}

  /** Return the newest confirmed merged request URL after complete discovery.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  async getMergedMRUrl(issueId: number): Promise<string | null> {
    const mrs = await this.discovery.getRelatedMRs(issueId);
    const merged = mrs.filter(mr => mr.state === GITLAB_REQUEST_STATE.MERGED);

    return merged[0]?.web_url ?? null;
  }

  /** Observe MR state; required review read failures propagate rather than reporting no feedback.
   * @param issueId - Managed issue whose associated MR state is observed.
   * @param prUrl - Optional exact request URL supplied by prior application evidence.
   */
  async getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    const found = await this.discovery.getRelatedMRs(issueId);
    const mrs = prUrl ? found.filter(mr => mr.web_url === prUrl) : found;

    if (prUrl && !mrs.length) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "gitlab",
      retryable: false, message: `Previously selected MR is no longer associated with this issue: ${prUrl}` });
    // Check open MRs first
    const open = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.OPEN);

    if (open) {
      const approved = await this.reviews.isMrApproved(open.iid);

      // Detect changes requested via unresolved discussion threads
      let state: PrState;

      if (approved) {
        state = PR_STATE.APPROVED;
      } else {
        const hasUnresolved = await this.reviews.hasUnresolvedDiscussions(open.iid);

        if (hasUnresolved) {
          state = PR_STATE.CHANGES_REQUESTED;
        } else {
          // Check for top-level conversation comments from non-author users
          const hasComments = await this.reviews.hasConversationComments(open.iid);

          state = hasComments ? PR_STATE.HAS_COMMENTS : PR_STATE.OPEN;
        }
      }

      // Detect merge conflicts
      const mergeable = await this.discovery.isMrMergeable(open.iid);

      return { state, url: open.web_url, title: open.title, sourceBranch: open.source_branch, mergeable };
    }

    // Check merged MRs
    const merged = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.MERGED);

    if (merged) return { state: PR_STATE.MERGED, url: merged.web_url, title: merged.title, sourceBranch: merged.source_branch };
    // Check for closed-without-merge MRs. url: non-null = MR was explicitly closed;
    // url: null = no MR has ever been created for this issue.
    const closed = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.CLOSED);

    if (closed) return { state: PR_STATE.CLOSED, url: closed.web_url, title: closed.title, sourceBranch: closed.source_branch };

    return { state: PR_STATE.CLOSED, url: null };
  }

  /** Merge one exact observed MR within the owning project.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async mergePr(issueId: number, prUrl?: string): Promise<void> {
    const open = await this.discovery.selectOpenMr(issueId, prUrl);

    if (!open) throw new Error(`No open MR found for issue #${issueId}`);
    await this.transport.once(["mr", "merge", String(open.iid)]);
  }

  /** Read one selected MR's diff without replacing an unavailable explicit target.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    const open = await this.discovery.selectOpenMr(issueId, prUrl);

    if (!open) return null;
    try {
      return await this.transport.read(["mr", "diff", String(open.iid)]);
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference; MR numbers are independent identities.
   * Used as a fallback when no MR exists (e.g., direct commit to main).
   * @param issueId - Positive issue identifier to match exactly.
   * @param baseBranch - Configured base branch whose history is inspected.
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      return await hasIssueCommitOnBaseBranch(this.transport.runCommand, this.transport.repoPath, issueId, baseBranch);
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }
}
