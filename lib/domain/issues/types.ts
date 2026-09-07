/**
 * issues/types.ts — Runtime state for DevClaw-managed provider issues.
 */
import type { ValueOf } from "../../types.js";
import type { NotifyBindingRef } from "../notifications/types.js";
import type { ReviewPolicy, TestPolicy } from "../workflow/types.js";
import {
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_CREATION_ERROR,
  ISSUE_CREATION_STATUS,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  PIPELINE_NOTIFICATION_STATUS,
} from "./const.js";

/** Supported issue tracking provider identifier. */
export type IssueProviderId = ValueOf<typeof ISSUE_PROVIDER>;

/** Status of the issue's local state relative to the provider. */
export type IssueIntegrityStatus = ValueOf<typeof ISSUE_INTEGRITY_STATUS>;

/** Reason a managed issue was moved into the archive store. */
export type IssueArchiveReason = ValueOf<typeof ISSUE_ARCHIVE_REASON>;

/** Retention state of files associated with an archived issue. */
export type AttachmentDisposition = ValueOf<typeof ATTACHMENT_DISPOSITION>;

/** Durable managed-issue creation stage. */
export type IssueCreationStatus = ValueOf<typeof ISSUE_CREATION_STATUS>;

/** Stable managed-issue creation failure code. */
export type IssueCreationErrorCode = ValueOf<typeof ISSUE_CREATION_ERROR>;

/** Consecutive provider-missing confirmations retained between heartbeat ticks. */
export type ProviderMissingState = {
  /** Number of confirmed issue-not-found responses. */
  confirmations: number;
  /** ISO timestamp of the first confirmed response. */
  firstConfirmedAt: string;
  /** ISO timestamp of the most recent confirmed response. */
  lastConfirmedAt: string;
};

/** Persisted delivery marker for the terminal pipeline notification. */
export type PipelineNotificationState = {
  /** Stable key identifying the terminal event. */
  eventKey: string;
  /** Current persistence state of the delivery. */
  status: ValueOf<typeof PIPELINE_NOTIFICATION_STATUS>;
  /** ISO timestamp written before external delivery begins. */
  attemptedAt: string;
  /** ISO timestamp written after the adapter confirms delivery. */
  deliveredAt?: string;
};

/** Local state details for issue synchronization and validation. */
export type IssueProjectionState = {
  /** Health status of the projection. **/
  integrityStatus: IssueIntegrityStatus;
  /** List of drift or integrity errors detected. */
  integrityErrors: string[];
  /** Version of the provider-side projection format. */
  projectionVersion: number;
};

/** Git branches and pull request metadata associated with the issue. */
export type BranchContract = {
  /** Developer's working branch name. */
  branch?: string;
  /** Target base branch (e.g. main/master). */
  baseBranch?: string;
  /** URL of the opened pull request, if any. */
  pullRequestUrl?: string | null;
};

/** Details about the worker currently active on the issue. */
export type ActiveIssueWorker = {
  /** The assigned worker role (e.g. developer, tester). */
  role: string;
  /** The assigned worker tier/level (e.g. junior, senior). */
  level: string;
  /** Index of the worker slot. */
  slotIndex: number;
  /** Unique session key of the active run. */
  sessionKey: string | null;
  /** ISO timestamp when work started. */
  startedAt: string;
};

/** Main local runtime state for a managed provider issue. */
export type IssueRuntimeState = IssueProjectionState & {
  /** Creation saga that must reach ready before lifecycle consumers may use this issue. */
  creationOperationId?: string;
  /** Slug of the project owning this issue. */
  projectSlug: string;
  /** Unique numeric identifier for the issue on the provider. */
  issueId: number;
  /** Provider host name. */
  provider: IssueProviderId;
  /** Current state key in the workflow statechart. */
  workflowState: string;
  /** Current display state label matching the provider label. */
  workflowLabel: string;
  /** Role currently assigned to resolve the issue. */
  assignedRole?: string | null;
  /** Developer level currently assigned. */
  assignedLevel?: string | null;
  /** User name of the currently assigned human owner. */
  owner?: string | null;
  /** Override review policy for this issue. */
  reviewPolicy?: ReviewPolicy | null;
  /** Override test policy for this issue. */
  testPolicy?: TestPolicy | null;
  /** Overridden notify destination for this issue. */
  notifyTarget?: NotifyBindingRef | null;
  /** Branch and PR references. */
  branchContract?: BranchContract | null;
  /** Active session worker details. */
  activeWorker?: ActiveIssueWorker | null;
  /** ISO timestamp when managed state was created. */
  createdAt: string;
  /** ISO timestamp of the last state update. */
  updatedAt: string;
  /** ISO timestamp when the issue was closed. */
  closedAt?: string | null;
  /** Pending confirmation state when the provider no longer returns this issue. */
  providerMissing?: ProviderMissingState | null;
  /** Scheduled retry that keeps a failed terminal-looking state active. */
  retryAt?: string | null;
  /** Remaining automatic retries for a failed state. */
  retriesRemaining?: number;
  /** Terminal notification delivery marker used for deduplication. */
  pipelineNotification?: PipelineNotificationState | null;
};

/** Audit-oriented record stored after an issue leaves active runtime state. */
export type ArchivedIssueRecord = {
  /** Stable project owner of the archived issue. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider owning the issue. */
  provider: IssueProviderId;
  /** Last known provider title, when available. */
  title?: string;
  /** Last known provider URL, when available. */
  issueUrl?: string;
  /** Final workflow state before archiving. */
  finalWorkflowState: string;
  /** Final provider-facing workflow label. */
  finalWorkflowLabel?: string;
  /** Reason the issue left active runtime state. */
  archiveReason: IssueArchiveReason;
  /** ISO timestamp of issue closure, when it was closed normally. */
  closedAt?: string | null;
  /** ISO timestamp when provider deletion was confirmed. */
  providerDeletedAt?: string | null;
  /** ISO timestamp of archiving. */
  archivedAt: string;
  /** Last recorded integrity status before archive. */
  lastIntegrityStatus: IssueIntegrityStatus;
  /** Last known branch and pull-request references. */
  branchContract?: BranchContract | null;
  /** Current retention state of associated files. */
  attachmentDisposition: AttachmentDisposition;
  /** SHA-256 of the active runtime snapshot used to create this record. */
  sourceSnapshotHash: string;
};

/** Dedicated project-local archive store persisted in issues.archive.json. */
export type IssueArchiveStore = {
  /** Storage schema version. */
  version: 1;
  /** Project slug that owns every record. */
  projectSlug: string;
  /** Records keyed by stable provider/project/issue identity. */
  issues: Record<string, ArchivedIssueRecord>;
};

/** Local filesystem state store schema for project issues. */
export type IssueStateStore = {
  /** Storage schema version. */
  version: 2;
  /** Project slug. */
  projectSlug: string;
  /** Active managed issues keyed by stringified issue ID. */
  issues: Record<string, IssueRuntimeState>;
};

/** Persisted input and resolved defaults required to resume issue creation after restart. */
export type IssueCreationInput = {
  title: string;
  body: string;
  assignees: string[];
  workflowState: string;
  workflowLabel: string;
  assignedRole: string | null;
  assignedLevel: string | null;
  owner: string | null;
  reviewPolicy: ReviewPolicy;
  testPolicy: TestPolicy;
  notifyTarget: NotifyBindingRef | null;
  provider: IssueProviderId;
};

/** Provider identity retained immediately after create succeeds. */
export type CreatedProviderIssueRef = {
  issueId: number;
  url: string;
  createdAt: string;
};

/** Last durable failure associated with a creation operation. */
export type IssueCreationFailure = {
  code: IssueCreationErrorCode;
  message: string;
  retryable: boolean;
  retryAfter?: string;
};

/** Durable saga record that prevents incomplete provider issues from entering runtime state. */
export type IssueCreationOperation = {
  operationId: string;
  idempotencyKey: string;
  payloadHash: string;
  projectSlug: string;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  status: IssueCreationStatus;
  input: IssueCreationInput;
  expectedLabels: string[];
  providerIssue?: CreatedProviderIssueRef;
  completedSteps: string[];
  pendingSteps: string[];
  attempts: number;
  retryAfter?: string;
  lastError?: IssueCreationFailure;
  auditCorrelationId: string;
};

/** Per-project durable store of creation operations keyed by idempotency key. */
export type IssueCreationStore = {
  version: 1;
  projectSlug: string;
  operations: Record<string, IssueCreationOperation>;
};
