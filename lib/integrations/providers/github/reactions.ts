/** Owns GitHub reactions operations and their provider-specific API semantics. */

import { PROVIDER_HTTP_METHOD } from "../const.js";
import type { ProviderTransport } from "../types.js";
import { GITHUB_API_RESOURCE,GITHUB_DISCOVERY_STATE } from "./const.js";
import { GitHubDiscovery } from "./discovery.js";
import { githubApiPath } from "./endpoints.js";
import { GhReactionSchema } from "./schema.js";

/** Implements the reactions capability using dependencies shared by one adapter instance. */
export class GitHubReactions {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param discovery - Shared discovery capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly discovery: GitHubDiscovery) {}

  /** Submit one best-effort cosmetic issue reaction without automatic replay.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.transport.once([
        "api", githubApiPath(GITHUB_API_RESOURCE.ISSUES, issueId, GITHUB_API_RESOURCE.REACTIONS),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** Observe an issue reaction; unavailable cosmetic evidence remains false.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.ISSUES, issueId, GITHUB_API_RESOURCE.REACTIONS), GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  /** Submit one best-effort reaction to the deterministically selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      // GitHub PRs are also issues — use the same reactions API with the PR number
        const prs = await this.discovery.findPrsForIssue(issueId, GITHUB_DISCOVERY_STATE.OPEN);

      if (prs.length === 0) return;
      await this.transport.once([
        "api", githubApiPath(GITHUB_API_RESOURCE.ISSUES, prs[0].number, GITHUB_API_RESOURCE.REACTIONS),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** Observe cosmetic reaction evidence on the selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
        const prs = await this.discovery.findPrsForIssue(issueId, GITHUB_DISCOVERY_STATE.OPEN);

      if (prs.length === 0) return false;
      const reactions = await this.transport.collection(githubApiPath(GITHUB_API_RESOURCE.ISSUES, prs[0].number, GITHUB_API_RESOURCE.REACTIONS), GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  /** Submit one best-effort reaction in the issue-comment source namespace.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToIssueComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.transport.once([
        "api", githubApiPath(GITHUB_API_RESOURCE.ISSUES, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /**
   * Add an emoji reaction to a PR/MR issue comment.
   * Uses the GitHub Issues Comments Reactions API (PRs share the issue comment namespace).
   * Best-effort — swallows all errors.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async reactToPrComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.transport.once([
        "api", githubApiPath(GITHUB_API_RESOURCE.ISSUES, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** React to an inline review comment using its distinct pull-request comment namespace.
   * @param _issueId - Owning issue; comment IDs already identify the repository resource.
   * @param commentId - Inline review comment identifier, never a review summary ID.
   * @param emoji - GitHub reaction content.
   */
  async reactToPrReviewComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    await this.transport.once(["api", githubApiPath(GITHUB_API_RESOURCE.PULLS, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
      "--method", PROVIDER_HTTP_METHOD.POST, "--field", `content=${emoji}`]);
  }

  /** Observe cosmetic reaction evidence in the issue-comment namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.transport.collection(
        githubApiPath(GITHUB_API_RESOURCE.ISSUES, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
        GhReactionSchema,
      );

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  /** Observe cosmetic reaction evidence in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.transport.collection(
        githubApiPath(GITHUB_API_RESOURCE.ISSUES, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
        GhReactionSchema,
      );

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  /** Check existing reactions in the inline review-comment namespace.
   * @param _issueId - Owning issue; the comment ID identifies the resource.
   * @param commentId - Inline review comment identifier.
   * @param emoji - Reaction content to find.
   */
  async prReviewCommentHasReaction(_issueId: number, commentId: number, emoji: string): Promise<boolean> {
    const reactions = await this.transport.collection(
      githubApiPath(GITHUB_API_RESOURCE.PULLS, GITHUB_API_RESOURCE.COMMENTS, commentId, GITHUB_API_RESOURCE.REACTIONS),
      GhReactionSchema,
    );

    return reactions.some(reaction => reaction.content === emoji);
  }
}
