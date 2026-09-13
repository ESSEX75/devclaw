/**
 * Defines persisted managed-issue store records owned by the state layer.
 */
import type {
  ArchivedIssueRecord,
  IssueCreationErrorCode,
  IssueCreationStatus,
  IssueProviderId,
  IssueRuntimeState,
  NotifyBindingRef,
  ReviewPolicy,
  TestPolicy,
} from "../../domain/index.js";

/** Dedicated project-local archive persisted in `issues.archive.json`. */
export type IssueArchiveStore = {
  /** Storage schema version. */
  version: 1;
  /** Project slug that owns every record. */
  projectSlug: string;
  /** Records keyed by stable provider/project/issue identity. */
  issues: Record<string, ArchivedIssueRecord>;
};

/** Local filesystem store persisted in `issues.json`. */
export type IssueStateStore = {
  /** Storage schema version. */
  version: 2;
  /** Project slug that owns every active issue. */
  projectSlug: string;
  /** Active managed issues keyed by stringified issue ID. */
  issues: Record<string, IssueRuntimeState>;
};

/** Persisted input and resolved defaults required to resume issue creation after restart. */
export type IssueCreationInput = {
  /** Provider issue title requested by the caller. */
  title: string;
  /** Provider issue body requested by the caller. */
  body: string;
  /** Provider usernames assigned when the issue is created. */
  assignees: string[];
  /** Initial canonical workflow state key. */
  workflowState: string;
  /** Initial provider-facing workflow label. */
  workflowLabel: string;
  /** Resolved worker role, or null when the state has no role. */
  assignedRole: string | null;
  /** Resolved worker level, or null when no level is assigned. */
  assignedLevel: string | null;
  /** DevClaw instance owner, or null for an unclaimed issue. */
  owner: string | null;
  /** Resolved review-routing policy. */
  reviewPolicy: ReviewPolicy;
  /** Resolved test-routing policy. */
  testPolicy: TestPolicy;
  /** Explicit notification endpoint binding, or null for project default routing. */
  notifyTarget: NotifyBindingRef | null;
  /** Provider selected by resolved project configuration. */
  provider: IssueProviderId;
};

/** Provider identity retained immediately after create succeeds. */
export type CreatedProviderIssueRef = {
  /** Provider-local numeric issue identifier. */
  issueId: number;
  /** Canonical provider URL for the created issue. */
  url: string;
  /** ISO timestamp returned or recorded when provider creation succeeded. */
  createdAt: string;
};

/** Last durable failure associated with a creation operation. */
export type IssueCreationFailure = {
  /** Stable failure identifier used by recovery logic. */
  code: IssueCreationErrorCode;
  /** Operator-facing failure description. */
  message: string;
  /** Whether automatic recovery may safely retry the operation. */
  retryable: boolean;
  /** ISO timestamp before which retry should not occur. */
  retryAfter?: string;
};

/** Durable saga record that prevents incomplete provider issues from entering runtime state. */
export type IssueCreationOperation = {
  /** Unique identifier for this creation attempt lifecycle. */
  operationId: string;
  /** Caller-supplied key used to deduplicate equivalent requests. */
  idempotencyKey: string;
  /** Stable hash used to reject conflicting reuse of an idempotency key. */
  payloadHash: string;
  /** Project whose provider receives the issue. */
  projectSlug: string;
  /** Actor that requested issue creation. */
  requestedBy: string;
  /** ISO timestamp when the operation was first requested. */
  requestedAt: string;
  /** ISO timestamp of the latest durable mutation. */
  updatedAt: string;
  /** Current durable stage of the creation saga. */
  status: IssueCreationStatus;
  /** Validated creation input retained for restart recovery. */
  input: IssueCreationInput;
  /** Complete provider-label projection expected after creation. */
  expectedLabels: string[];
  /** Stable provider identity once provider creation has succeeded. */
  providerIssue?: CreatedProviderIssueRef;
  /** Idempotent saga steps already completed. */
  completedSteps: string[];
  /** Saga steps still required before the issue becomes ready. */
  pendingSteps: string[];
  /** Number of provider or recovery attempts performed. */
  attempts: number;
  /** ISO timestamp before which automatic retry should not occur. */
  retryAfter?: string;
  /** Most recent durable failure, when the operation is not healthy. */
  lastError?: IssueCreationFailure;
  /** Correlation identifier shared by audit events for this operation. */
  auditCorrelationId: string;
};

/** Per-project durable store of creation operations keyed by idempotency key. */
export type IssueCreationStore = {
  /** Storage schema version. */
  version: 1;
  /** Project slug that owns every operation. */
  projectSlug: string;
  /** Creation operations keyed by their caller-supplied idempotency key. */
  operations: Record<string, IssueCreationOperation>;
};
