/**
 * Owns normalized provider observations and capability contracts consumed by application and adapters.
 */

import type { ValueOf } from "../../../types.js";
import type { PR_COMMENT_KIND, PROVIDER_COLLECTION_STATE } from "./const.js";
import { PR_STATE } from "./const.js";

/** Provider-visible label identifier; application owns its workflow meaning. */
export type StateLabel = string;

/** Normalized provider issue observation; local issue state remains authoritative. */
export type Issue = {
  /** Provider-local issue identity; it never establishes managed runtime state. */
  iid: number;
  /** Provider-visible title retained in the normalized observation. */
  title: string;
  /** Provider-visible issue description. */
  description: string;
  /** Explicit provider-visible label names; never authoritative workflow state. */
  labels: string[];
  /** Provider lifecycle or review observation, independent of local workflow ownership. */
  state: string;
  /** Provider-confirmed browser URL for this issue. */
  web_url: string;
};

/** Normalized provider conversation comment with its source identity. */
export type IssueComment = {
  /** Identity within the provider resource namespace. */
  id: number;
  /** Provider-visible author identity. */
  author: string;
  /** Complete text submitted to or observed from the provider. */
  body: string;
  /** Provider timestamp retained for ordering feedback observations. */
  created_at: string;
};

/** Provider-neutral lifecycle and review observations derived from the canonical registry. */
export type PrState = ValueOf<typeof PR_STATE>;

/** Selected request observation whose optional evidence preserves uncertainty. */
export type PrStatus = {
  /** Provider lifecycle or review observation, independent of local workflow ownership. */
  state: PrState;
  /** Selected provider URL, or null only after validated absence. */
  url: string | null;
  /** Provider-visible title retained in the normalized observation. */
  title?: string;
  /** Provider-confirmed source branch of the selected request. */
  sourceBranch?: string;
  /** Explicit conflict evidence; absent values retain uncertainty. */
  mergeable?: boolean;
  /** COMMENTED review summaries requiring application-owned local receipt comparison. */
  reviewSummaries?: PrReviewComment[];
  /** Non-summary feedback still observed without the cosmetic acknowledgement indicator. */
  hasCommentFeedback?: boolean;
};

/** Provider review observation with an explicit source namespace for safe acknowledgement. */
export type PrReviewComment = {
  /** Original provider source; independent of approval state or optional file location. */
  kind: ValueOf<typeof PR_COMMENT_KIND>;
  /** Identifier within the source namespace. */
  id: number;
  /** Provider display name of the author. */
  author: string;
  /** Review text supplied to workers. */
  body: string;
  /** Provider review status, independent of the reaction namespace. */
  state: string;
  /** Provider timestamp used to order observations. */
  created_at: string;
  /** Optional file location for inline feedback. */
  path?: string;
  /** Optional line within the referenced file. */
  line?: number;
};

/** Explicit provider-side issue collection filters. */
export type IssueListFilter = {
  /** Exact provider label used as an observation filter or explicit mutation target. */
  label?: string;
  /** Provider lifecycle or review observation, independent of local workflow ownership. */
  state?: ValueOf<typeof PROVIDER_COLLECTION_STATE>;
};

/** Complete provider issue payload used by transactional creation. */
export type CreateIssueInput = {
  /** Provider-visible title retained in the normalized observation. */
  title: string;
  /** Complete text submitted to or observed from the provider. */
  body: string;
  /** Explicit provider-visible label names; never authoritative workflow state. */
  labels: string[];
  /** Explicit provider login identities assigned during creation. */
  assignees: string[];
};

/** Read-only issue observations; malformed and failed responses cannot establish absence. */
export interface IssueReader {
  /** Execute the explicit listIssuesByLabel provider capability.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  listIssuesByLabel(label: StateLabel): Promise<Issue[]>;
  /** Execute the explicit listIssues provider capability.
   * @param opts - Repository dependencies or provider-side query filters for this capability.
   */
  listIssues(opts?: IssueListFilter): Promise<Issue[]>;
  /** Read a validated issue, distinguishing missing identity from failed repository access.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  getIssue(issueId: number): Promise<Issue>;
  /** Read complete issue conversation pages into normalized feedback observations.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  listComments(issueId: number): Promise<IssueComment[]>;
}

/** Explicit issue mutations with adapter-owned response and retry guarantees. */
export interface IssueWriter {
  /** Submit one issue creation; an unidentified or lost response never authorizes replay.
   * @param input - Complete application-selected issue payload for one creation attempt.
   */
  createIssue(input: CreateIssueInput): Promise<Issue>;
  /** Apply an explicitly selected closed state idempotently.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  closeIssue(issueId: number): Promise<void>;
  /** Apply an explicitly selected open state idempotently.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  reopenIssue(issueId: number): Promise<void>;
  /** Execute the explicit addComment provider capability.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param body - Complete text submitted to or observed from the provider.
   */
  addComment(issueId: number, body: string): Promise<number>;
  /** Apply explicit title/body edits and return the subsequent validated issue observation.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param updates - Explicit title and body fields selected for provider mutation.
   */
  editIssue(issueId: number, updates: IssueEditInput): Promise<Issue>;
}

/** Destructive provider capability used only by the confirmed issue-delete use case. */
export interface IssueDeleter {
  /** Whether this adapter has an explicit provider deletion implementation. */
  supportsIssueDeletion(): boolean;
  /** Permanently delete one provider issue.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  deleteIssue(issueId: number): Promise<void>;
}

/** Applies application-selected labels without interpreting workflow configuration. */
export interface LabelProjector {
  /** Apply the exact application-selected label name and color idempotently.
   * @param name - Exact provider label name selected by application configuration.
   * @param color - Configured provider label color.
   */
  ensureLabel(name: string, color: string): Promise<void>;
  /** Apply only the explicitly supplied provider labels; no workflow is inferred.
   * @param issueId - Provider-local issue identity.
   * @param labels - Exact labels selected by application orchestration.
   */
  addLabels(issueId: number, labels: string[]): Promise<void>;
  /** Add only the explicit application-selected provider label.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  addLabel(issueId: number, label: string): Promise<void>;
  /** Remove only explicitly selected labels; an empty set has no external effects.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param labels - Explicit provider-visible label names; never authoritative workflow state.
   */
  removeLabels(issueId: number, labels: string[]): Promise<void>;
}

/** Observes associated requests without selecting local workflow transitions. */
export interface PullRequestReader {
  /** Return the newest confirmed merged request URL after complete discovery.
   * @param issueId - Provider-local issue identity within the configured repository.
   */
  getMergedMRUrl(issueId: number): Promise<string | null>;
  /** Observe the exact previously selected request, or choose deterministically when no target is supplied.
   * @param issueId - Managed issue whose associated request is inspected.
   * @param prUrl - Optional exact request URL; unavailable targets are failed observations.
   */
  getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus>;
  /** Read the selected request's diff; an unavailable explicit target never redirects to another PR.
   * @param issueId - Managed issue whose associated request is inspected.
   * @param prUrl - Optional exact URL from a previous status observation.
   */
  getPrDiff(issueId: number, prUrl?: string): Promise<string | null>;
}

/** Applies explicit request operations and observes direct commits. */
export interface PullRequestOperator {
  /** Merge the selected request once, preserving an application-supplied exact target.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact request URL; missing targets fail before mutation.
   */
  mergePr(issueId: number, prUrl?: string): Promise<void>;
  /** Execute the explicit isCommitOnBaseBranch provider capability.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param baseBranch - Application-selected base branch whose complete history is inspected.
   */
  isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean>;
}

/** Reads complete feedback scoped to the exact selected request. */
export interface ReviewReader {
  /** Read all feedback for one selected request without mixing observations from another PR.
   * @param issueId - Managed issue whose feedback is requested.
   * @param prUrl - Optional exact request URL observed by application orchestration.
   */
  getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]>;
}

/** Owns endpoint-specific cosmetic reaction observations and mutations. */
export interface ReactionWriter {
  /** Submit one best-effort cosmetic issue reaction without automatic replay.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToIssue(issueId: number, emoji: string): Promise<void>;
  /** Observe an issue reaction; unavailable cosmetic evidence remains false.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  issueHasReaction(issueId: number, emoji: string): Promise<boolean>;
  /** Submit one best-effort reaction to the deterministically selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPr(issueId: number, emoji: string): Promise<void>;
  /** Observe cosmetic reaction evidence on the selected open request.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param emoji - Exact provider reaction identifier.
   */
  prHasReaction(issueId: number, emoji: string): Promise<boolean>;
  /** Submit one best-effort reaction in the issue-comment source namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  /** Submit one best-effort reaction in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  /** React to an inline review comment using its provider comment namespace.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  reactToPrReviewComment(issueId: number, commentId: number, emoji: string): Promise<void>;
  /** Observe cosmetic reaction evidence in the issue-comment namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  /** Observe cosmetic reaction evidence in the request conversation namespace.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param commentId - Provider comment identity within the endpoint-specific source namespace.
   * @param emoji - Exact provider reaction identifier.
   */
  prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
  /** Check whether an inline review comment already carries the requested reaction.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  prReviewCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean>;
}

/** Submits already locally saved bytes once and returns only a confirmed location. */
export interface AttachmentUploader {
  /** Execute the explicit uploadAttachment provider capability.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param file - Already locally persisted attachment bytes and untrusted display metadata.
   */
  uploadAttachment(issueId: number, file: AttachmentUploadInput): Promise<string | null>;
}

/** Observes provider CLI authentication availability. */
export interface ProviderHealthCheck {
  /** Probe CLI authentication; unavailability is a failed health observation. */
  healthCheck(): Promise<boolean>;
}

/** Current provider request budget when the adapter can query it safely. */
export type ProviderRateLimitStatus = {
  /** Requests remaining in the relevant provider budget. */
  remaining: number;
  /** ISO reset time when exposed by the provider. */
  resetAt?: string;
};

/** Optional quota preflight used by explicitly planned mutations. */
export interface ProviderRateLimitReader {
  /** Read the validated core request budget for mutation preflight. */
  getRateLimitStatus?(): Promise<ProviderRateLimitStatus>;
}

/** Complete provider facade composed from supported capabilities. */
export interface IssueProvider
  extends IssueReader,
    IssueWriter,
    IssueDeleter,
    LabelProjector,
    ReviewReader,
    PullRequestReader,
    PullRequestOperator,
    ReactionWriter,
    AttachmentUploader,
    ProviderHealthCheck,
    ProviderRateLimitReader {}

/** Explicit issue edits owned by application; omitted fields remain unchanged. */
export type IssueEditInput = {
  /** Replacement provider-visible title when supplied. */
  title?: string;
  /** Replacement complete provider-visible body when supplied. */
  body?: string;
};

/** Already persisted attachment data supplied to an external upload boundary. */
export type AttachmentUploadInput = {
  /** Untrusted display name flattened before filesystem use. */
  filename: string;
  /** Locally durable bytes to publish externally. */
  buffer: Buffer;
  /** Resolved attachment media type. */
  mimeType: string;
};
