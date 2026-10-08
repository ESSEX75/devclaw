/** Composes GitLab capabilities into the supported provider facade; owns no workflow decisions. */

import type { ProviderAdapterOptions } from "../transport/index.js";
import { PROVIDER_CLI } from "../transport/index.js";
import { createProviderTransport } from "../transport/index.js";
import type {
  AttachmentUploadInput,
  CreateIssueInput,
  Issue,
  IssueComment,
  IssueEditInput,
  IssueListFilter,
  IssueProvider,
  PrReviewComment,
  PrStatus,
  StateLabel,
} from "../types.js";
import { GitLabAttachments } from "./attachments.js";
import { GitLabDiscovery } from "./discovery.js";
import { GitLabHealth } from "./health.js";
import { GitLabIssues } from "./issues.js";
import { GitLabLabels } from "./labels.js";
import { GitLabPullRequests } from "./pull-requests.js";
import { GitLabReactions } from "./reactions.js";
import { GitLabRepository } from "./repository.js";
import { GitLabReviews } from "./reviews.js";

/** Public facade sharing transport, identity caches and discovery across all capabilities. */
export class GitLabProvider implements IssueProvider {
  /** Instance-owned repository capability. */
  private readonly repository: GitLabRepository;
  /** Instance-owned discovery capability. */
  private readonly discovery: GitLabDiscovery;
  /** Instance-owned issues capability. */
  private readonly issues: GitLabIssues;
  /** Instance-owned labels capability. */
  private readonly labels: GitLabLabels;
  /** Instance-owned pull-requests capability. */
  private readonly pullRequests: GitLabPullRequests;
  /** Instance-owned reviews capability. */
  private readonly reviews: GitLabReviews;
  /** Instance-owned reactions capability. */
  private readonly reactions: GitLabReactions;
  /** Instance-owned attachments capability. */
  private readonly attachments: GitLabAttachments;
  /** Instance-owned health capability. */
  private readonly health: GitLabHealth;

  /** Compose isolated capabilities for one configured repository.
   * @param opts - Repository and plugin-owned command capability.
   */
  constructor(opts: ProviderAdapterOptions) {
    const transport = createProviderTransport(opts, PROVIDER_CLI.GITLAB);

    this.repository = new GitLabRepository(transport);
    this.discovery = new GitLabDiscovery(transport, this.repository);
    this.issues = new GitLabIssues(transport);
    this.labels = new GitLabLabels(transport);
    this.reactions = new GitLabReactions(transport, this.discovery);
    this.reviews = new GitLabReviews(transport, this.reactions, this.discovery);
    this.pullRequests = new GitLabPullRequests(transport, this.discovery, this.reviews);
    this.attachments = new GitLabAttachments(transport);
    this.health = new GitLabHealth(transport);
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

  /** Read all open issue pages carrying the requested label.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    return this.issues.listIssuesByLabel(label);
  }

  /** Read complete issue collections, preserving provider-side filter semantics.
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

  /** Read all non-system issue notes before constructing worker discussion.
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

  /** Observe MR state; required review read failures propagate rather than reporting no feedback.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    return this.pullRequests.getPrStatus(issueId, prUrl);
  }

  /** Merge one exact observed MR within the owning project.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  mergePr(issueId: number, prUrl?: string): Promise<void> {
    return this.pullRequests.mergePr(issueId, prUrl);
  }

  /** Read one selected MR's diff without replacing an unavailable explicit target.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    return this.pullRequests.getPrDiff(issueId, prUrl);
  }

  /** Read complete feedback for one selected MR, deduplicating its shared note identities.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param prUrl - Optional exact URL selected by prior application observations.
   */
  getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    return this.reviews.getPrReviewComments(issueId, prUrl);
  }

  /** Create one note without replaying a mutation whose response may have been lost.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param body - Complete text submitted to or observed from the provider.
   */
  addComment(issueId: number, body: string): Promise<number> {
    return this.issues.addComment(issueId, body);
  }

  /** Add an emoji award (reaction) to an MR note/comment.
   * Uses the GitLab Award Emoji API on MR notes.
   * Best-effort — swallows all errors.
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
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToIssueComment(issueId, commentId, emoji);
  }

  /** Submit one best-effort reaction in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToPrComment(issueId, commentId, emoji);
  }

  /** React to an inline review comment using its provider comment namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPrReviewComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    return this.reactions.reactToPrReviewComment(issueId, commentId, emoji);
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

  /** Check whether an inline review comment already carries the requested reaction.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  prReviewCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.reactions.prReviewCommentHasReaction(issueId, commentId, emoji);
  }

  /** Apply explicit title/body edits and return the subsequent validated issue observation.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param updates - Explicit title and body fields selected for provider mutation.
   */
  editIssue(issueId: number, updates: IssueEditInput): Promise<Issue> {
    return this.issues.editIssue(issueId, updates);
  }

  /** Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference; MR numbers are independent identities.
   * Used as a fallback when no MR exists (e.g., direct commit to main).
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param baseBranch - Application-selected base branch whose complete history is inspected.
   */
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    return this.pullRequests.isCommitOnBaseBranch(issueId, baseBranch);
  }

  /** Publish already saved bytes once; unavailable or unconfirmed uploads leave the local attachment usable.
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
