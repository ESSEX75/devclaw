/** Owns GitLab reactions operations and their provider-specific API semantics. */

import { classifyProviderLookupFailure } from "../../errors/index.js";
import type { ProviderTransport } from "../../transport/index.js";
import { PROVIDER_HTTP_METHOD } from "../../transport/index.js";
import { GITLAB_API_RESOURCE, GITLAB_REQUEST_STATE, gitlabApiPath } from "../api/index.js";
import { GitLabDiscovery } from "../discovery/index.js";
import { GITLAB_REACTION_RESOURCE } from "./const.js";
import { GitLabEmojiSchema } from "./schema.js";

/** Implements the reactions capability using dependencies shared by one adapter instance. */
export class GitLabReactions {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param discovery - Shared discovery capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly discovery: GitLabDiscovery) {}

  /**
   * Add an emoji award (reaction) to an MR note/comment.
   * Uses the GitLab Award Emoji API on MR notes.
   * Best-effort — swallows all errors.
   * @param issueId  Used to locate the associated open MR via getRelatedMRs
   * @param commentId  The note ID on the MR
   * @param emoji  Emoji name without colons (e.g. "robot", "thumbsup")
   */
  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.transport.once([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.ISSUES, issueId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** Observe an issue reaction; unavailable cosmetic evidence remains false.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const emojis = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.ISSUES, issueId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI), GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  /** Submit one best-effort reaction to the deterministically selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.discovery.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.OPEN);

      if (!open) return;
      await this.transport.once([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, open.iid, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** Observe cosmetic reaction evidence on the selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.discovery.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.OPEN);

      if (!open) return false;
      const emojis = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, open.iid, GITLAB_REACTION_RESOURCE.AWARD_EMOJI), GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  /** Submit one best-effort reaction in the issue-comment source namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.transport.once([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.ISSUES, issueId, GITLAB_API_RESOURCE.NOTES, commentId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** Submit one best-effort reaction in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.discovery.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.OPEN);

      if (!open) return;
      await this.transport.once([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, open.iid, GITLAB_API_RESOURCE.NOTES, commentId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** React to an inline review comment using its provider comment namespace.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  async reactToPrReviewComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    await this.reactToPrComment(issueId, commentId, emoji);
  }

  /** Observe cosmetic reaction evidence in the issue-comment namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const emojis = await this.transport.collection(
        gitlabApiPath(GITLAB_API_RESOURCE.ISSUES, issueId, GITLAB_API_RESOURCE.NOTES, commentId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        GitLabEmojiSchema,
      );

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  /** Observe cosmetic reaction evidence in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.discovery.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === GITLAB_REQUEST_STATE.OPEN);

      if (!open) return false;
      const emojis = await this.transport.collection(
        gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, open.iid, GITLAB_API_RESOURCE.NOTES, commentId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        GitLabEmojiSchema,
      );

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  /** Check whether an inline review comment already carries the requested reaction.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  async prReviewCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.prCommentHasReaction(issueId, commentId, emoji);
  }

  /** Check if a note already has an 👀 award emoji (marks it as processed).
   * @param mrIid - Provider-local IID of the exact selected merge request.
   * @param noteId - Provider note identity within the selected merge request.
   */
  async noteHasEyesEmoji(mrIid: number, noteId: number): Promise<boolean> {
    try {
      const emojis = await this.transport.collection(
        gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid, GITLAB_API_RESOURCE.NOTES, noteId, GITLAB_REACTION_RESOURCE.AWARD_EMOJI),
        GitLabEmojiSchema,
      );

      return emojis.some((e) => e.name === "eyes");
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }
}
