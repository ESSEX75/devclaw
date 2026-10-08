/** Owns GitLab reviews operations and their provider-specific API semantics. */

import type { PrReviewComment } from "../contracts/index.js";
import { PR_COMMENT_KIND, PROVIDER_FEEDBACK_STATE, PROVIDER_REVIEW_STATE } from "../contracts/index.js";
import { classifyProviderLookupFailure } from "../errors/index.js";
import type { ProviderTransport } from "../transport/index.js";
import { GITLAB_API_RESOURCE, GITLAB_INLINE_NOTE_TYPE } from "./const.js";
import { GitLabDiscovery } from "./discovery.js";
import { gitlabApiPath } from "./endpoints.js";
import { GitLabReactions } from "./reactions.js";
import { GitLabApprovalSchema, GitLabDiscussionSchema, GitLabNoteSchema } from "./schema.js";
import type { GitLabNote } from "./types.js";

/** Implements the reviews capability using dependencies shared by one adapter instance. */
export class GitLabReviews {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param reactions - Shared reactions capability for this adapter.
   * @param discovery - Shared discovery capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly reactions: GitLabReactions, private readonly discovery: GitLabDiscovery) {}

  /** Check if an MR has unresolved discussion threads (proxy for changes requested).
   * @param mrIid - Provider-local IID of the exact selected merge request.
   */
  async hasUnresolvedDiscussions(mrIid: number): Promise<boolean> {
    try {
      const discussions = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid, GITLAB_API_RESOURCE.DISCUSSIONS), GitLabDiscussionSchema);

      return discussions.some((d) =>
        d.notes.some((n) => n.resolvable && !n.resolved && !n.system),
      );
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /**
   * Check if an MR has any top-level conversation notes from human users.
   * Excludes only system notes and empty bodies (author comments are included).
   * Uses the MR notes endpoint (regular comments, not threaded discussions).
   * @param mrIid - Provider-local IID of the exact selected merge request.
   */
  async hasConversationComments(mrIid: number): Promise<boolean> {
    try {
      const notes = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid, GITLAB_API_RESOURCE.NOTES), GitLabNoteSchema);
      const candidates = notes.filter((n) => !n.system && n.body.trim().length > 0);

      for (const note of candidates) {
        if (!(await this.reactions.noteHasEyesEmoji(mrIid, note.id))) return true;
      }

      return false;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /**
   * Fetch top-level conversation notes on an MR from human users.
   * Excludes only system notes and empty bodies.
   * @param mrIid - Provider-local IID of the exact selected merge request.
   */
  async fetchConversationComments(
    mrIid: number,
  ): Promise<GitLabNote[]> {
    try {
      const all = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid, GITLAB_API_RESOURCE.NOTES), GitLabNoteSchema);

      return all.filter(
        (n) => !n.system && n.body.trim().length > 0,
      );
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Check if an MR is approved via the dedicated approvals endpoint.
   * @param mrIid - Provider-local IID of the exact selected merge request.
   */
  async isMrApproved(mrIid: number): Promise<boolean> {
    try {
      const raw = await this.transport.read(["api", gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid, GITLAB_API_RESOURCE.APPROVALS)]);
      const response: unknown = JSON.parse(raw);
      const data = GitLabApprovalSchema.parse(response);
      // Only trust explicit approvals — ignore bare 'approved' flag.
      // When a project has zero approval rules, GitLab returns approved:true
      // even though nobody has actually reviewed, causing false positives.
      const hasExplicitApproval = Array.isArray(data.approved_by) && data.approved_by.length > 0;

      if (!hasExplicitApproval) return false;

      // All required approvals satisfied
      return (data.approvals_left ?? 1) <= 0;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Read complete feedback for one selected MR, deduplicating its shared note identities.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    const open = await this.discovery.selectOpenMr(issueId, prUrl);

    if (!open) return [];
    const comments: PrReviewComment[] = [];

    try {
      const discussions = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, open.iid, GITLAB_API_RESOURCE.DISCUSSIONS), GitLabDiscussionSchema);

      for (const disc of discussions) {
        for (const note of disc.notes) {
          if (note.system) continue;
          comments.push({
            kind: note.type === GITLAB_INLINE_NOTE_TYPE || note.position ? PR_COMMENT_KIND.INLINE : PR_COMMENT_KIND.CONVERSATION,
            id: note.id,
            author: note.author.username,
            body: note.body,
            state: note.resolvable ? (note.resolved ? "RESOLVED" : PROVIDER_FEEDBACK_STATE.UNRESOLVED) : PROVIDER_REVIEW_STATE.COMMENTED,
            created_at: note.created_at,
            path: note.position?.new_path,
            line: note.position?.new_line ?? undefined,
          });
        }
      }
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }

    // Also include top-level conversation notes (regular MR comments, not threaded)
    const conversationNotes = await this.fetchConversationComments(open.iid);

    for (const n of conversationNotes) {
      // Avoid duplicates: discussions endpoint may already include these
      if (!comments.some((c) => c.id === n.id)) {
        comments.push({
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: n.id,
          author: n.author.username,
          body: n.body,
          state: PROVIDER_REVIEW_STATE.COMMENTED,
          created_at: n.created_at,
        });
      }
    }

    comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return comments;
  }
}
