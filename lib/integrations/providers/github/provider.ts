/** Composes GitHub capabilities into the supported provider facade; owns no workflow decisions. */

import type {
  AttachmentUploadInput,
  CreateIssueInput,
  Issue,
  IssueComment,
  IssueEditInput,
  IssueListFilter,
  IssueProvider,
  ProviderRateLimitStatus,
  PrReviewComment,
  PrStatus,
  StateLabel,
} from "../contracts/index.js";
import type { ProviderAdapterOptions } from "../transport/index.js";
import { PROVIDER_CLI } from "../transport/index.js";
import { createProviderTransport } from "../transport/index.js";
import { GitHubAttachments } from "./attachments.js";
import { GitHubDiscovery } from "./discovery.js";
import { GitHubHealth } from "./health.js";
import { GitHubIssues } from "./issues.js";
import { GitHubLabels } from "./labels.js";
import { GitHubPullRequests } from "./pull-requests.js";
import { GitHubReactions } from "./reactions.js";
import { GitHubRepository } from "./repository.js";
import { GitHubReviews } from "./reviews.js";

/** Public facade sharing transport, identity caches and discovery across all capabilities. */
export class GitHubProvider implements IssueProvider {
  /** Instance-owned repository capability. */
  private readonly repository: GitHubRepository;
  /** Instance-owned discovery capability. */
  private readonly discovery: GitHubDiscovery;
  /** Instance-owned issues capability. */
  private readonly issues: GitHubIssues;
  /** Instance-owned labels capability. */
  private readonly labels: GitHubLabels;
  /** Instance-owned pull-requests capability. */
  private readonly pullRequests: GitHubPullRequests;
  /** Instance-owned reviews capability. */
  private readonly reviews: GitHubReviews;
  /** Instance-owned reactions capability. */
  private readonly reactions: GitHubReactions;
  /** Instance-owned attachments capability. */
  private readonly attachments: GitHubAttachments;
  /** Instance-owned health capability. */
  private readonly health: GitHubHealth;

  /** Compose isolated capabilities for one configured repository.
   * @param opts - Repository and plugin-owned command capability.
   */
  constructor(opts: ProviderAdapterOptions) {
    const transport = createProviderTransport(opts, PROVIDER_CLI.GITHUB);

    this.repository = new GitHubRepository(transport);
    this.discovery = new GitHubDiscovery(transport, this.repository);
    this.issues = new GitHubIssues(transport);
    this.labels = new GitHubLabels(transport);
    this.reactions = new GitHubReactions(transport, this.discovery);
    this.reviews = new GitHubReviews(transport, this.discovery);
    this.pullRequests = new GitHubPullRequests(transport, this.discovery, this.reviews);
    this.attachments = new GitHubAttachments(transport, this.repository);
    this.health = new GitHubHealth(transport);
  }

  /** Apply the exact application-selected label name and color idempotently.
   * @param name - Exact provider label name selected by application configuration.
   * @param color - Configured provider label color.
   */
  ensureLabel(name: string, color: string): Promise<void> {
    return this.labels.ensureLabel(name, color);
  }

  /** Submit one issue creation; an unidentified or lost response never authorizes replay.
   * @param input - Complete application-selected issue payload for one creation attempt.
   */
  createIssue(input: CreateIssueInput): Promise<Issue> {
    return this.issues.createIssue(input);
  }

  /** List all open issues carrying the requested provider-visible label.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    return this.issues.listIssuesByLabel(label);
  }

  /** Read every matching issue page; pull requests returned by the REST issues endpoint are excluded.
   * @param opts - Repository dependencies or provider-side query filters for this capability.
   */
  listIssues(opts?: IssueListFilter): Promise<Issue[]> {
    return this.issues.listIssues(opts);
  }

  /** Read a validated issue, distinguishing missing identity from failed repository access.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  getIssue(issueId: number): Promise<Issue> {
    return this.issues.getIssue(issueId);
  }

  /** Read GitHub's current core API quota for repair mutation preflight.
   */
  getRateLimitStatus(): Promise<ProviderRateLimitStatus> {
    return this.health.getRateLimitStatus();
  }

  /** Read all issue conversation pages before building worker context.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  listComments(issueId: number): Promise<IssueComment[]> {
    return this.issues.listComments(issueId);
  }

  /** Add only the explicit application-selected provider label.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  addLabel(issueId: number, label: string): Promise<void> {
    return this.labels.addLabel(issueId, label);
  }

  /** Remove only explicitly selected labels; an empty set has no external effects.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param labels - Explicit provider-visible label names; never authoritative workflow state.
   */
  removeLabels(issueId: number, labels: string[]): Promise<void> {
    return this.labels.removeLabels(issueId, labels);
  }

  /** Apply an explicitly selected closed state idempotently.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  closeIssue(issueId: number): Promise<void> {
    return this.issues.closeIssue(issueId);
  }

  /** Apply an explicitly selected open state idempotently.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  reopenIssue(issueId: number): Promise<void> {
    return this.issues.reopenIssue(issueId);
  }

  /** Declare whether the concrete adapter supports explicit issue deletion.
   */
  supportsIssueDeletion(): boolean {
    return this.issues.supportsIssueDeletion();
  }

  /** Delete once; abnormal completion never proves successful deletion.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  deleteIssue(issueId: number): Promise<void> {
    return this.issues.deleteIssue(issueId);
  }

  /** Return the newest confirmed merged request URL after complete discovery.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  getMergedMRUrl(issueId: number): Promise<string | null> {
    return this.pullRequests.getMergedMRUrl(issueId);
  }

  /** Observe PR state; missing PRs require successful lookup and failed reads remain typed errors.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    return this.pullRequests.getPrStatus(issueId, prUrl);
  }

  /** Merge one exact observed PR, never redirecting to another open candidate.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  mergePr(issueId: number, prUrl?: string): Promise<void> {
    return this.pullRequests.mergePr(issueId, prUrl);
  }

  /** Read the same selected PR's diff; failed explicit selection cannot yield another request's content.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    return this.pullRequests.getPrDiff(issueId, prUrl);
  }

  /** Read every feedback source for the same deterministically selected open PR.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    return this.reviews.getPrReviewComments(issueId, prUrl);
  }

  /** Create one comment without replaying a mutation whose response may have been lost.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param body - Complete text submitted to or observed from the provider.
   */
  addComment(issueId: number, body: string): Promise<number> {
    return this.issues.addComment(issueId, body);
  }

  /** Submit one best-effort cosmetic issue reaction without automatic replay.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToIssue(issueId: number, emoji: string): Promise<void> {
    return this.reactions.reactToIssue(issueId, emoji);
  }

  /** Observe an issue reaction; unavailable cosmetic evidence remains false.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    return this.reactions.issueHasReaction(issueId, emoji);
  }

  /** Submit one best-effort reaction to the deterministically selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPr(issueId: number, emoji: string): Promise<void> {
    return this.reactions.reactToPr(issueId, emoji);
  }

  /** Observe cosmetic reaction evidence on the selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    return this.reactions.prHasReaction(issueId, emoji);
  }

  /** Submit one best-effort reaction in the issue-comment source namespace.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToIssueComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToIssueComment(_issueId, commentId, emoji);
  }

  /** Add an emoji reaction to a PR/MR issue comment.
   * Uses the GitHub Issues Comments Reactions API (PRs share the issue comment namespace).
   * Best-effort — swallows all errors.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPrComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToPrComment(_issueId, commentId, emoji);
  }

  /** React to an inline review comment using its distinct pull-request comment namespace.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPrReviewComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToPrReviewComment(_issueId, commentId, emoji);
  }

  /** Observe cosmetic reaction evidence in the issue-comment namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.reactions.issueCommentHasReaction(issueId, commentId, emoji);
  }

  /** Observe cosmetic reaction evidence in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.reactions.prCommentHasReaction(issueId, commentId, emoji);
  }

  /** Check existing reactions in the inline review-comment namespace.
   * @param _issueId - Capability dependency scoped to this adapter.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  prReviewCommentHasReaction(_issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.reactions.prReviewCommentHasReaction(_issueId, commentId, emoji);
  }

  /** Apply explicit title/body edits and return the subsequent validated issue observation.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param updates - Explicit title and body fields selected for provider mutation.
   */
  editIssue(issueId: number, updates: IssueEditInput): Promise<Issue> {
    return this.issues.editIssue(issueId, updates);
  }

  /** Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference without a numeric-prefix match.
   * Used as a fallback when no PR exists (e.g., direct commit to main).
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param baseBranch - Application-selected base branch whose complete history is inspected.
   */
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    return this.pullRequests.isCommitOnBaseBranch(issueId, baseBranch);
  }

  /** Publish bytes once and return only a location confirmed by the Contents API response.
   * Unavailable or unidentified uploads preserve application-owned local attachment bytes.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param file - Already locally persisted attachment bytes and untrusted display metadata.
   */
  uploadAttachment(
    issueId: number,
    file: AttachmentUploadInput,
  ): Promise<string | null> {
    return this.attachments.uploadAttachment(issueId, file);
  }

  /** Probe CLI authentication; unavailability is a failed health observation.
   */
  healthCheck(): Promise<boolean> {
    return this.health.healthCheck();
  }

  /** Delegate explicit label additions to the concrete label capability.
   * @param issueId - Provider-local issue.
   * @param labels - Exact application-selected labels.
   */
  addLabels(issueId: number, labels: string[]): Promise<void> {
    return this.labels.addLabels(issueId, labels);
  }

}
