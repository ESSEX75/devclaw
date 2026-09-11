/**
 * issues/types.ts — Runtime state for DevClaw-managed provider issues.
 */
import type { ValueOf } from "../../types.js";
import type { NotifyBindingRef } from "../notifications/index.js";
import type { ReviewPolicy, TestPolicy } from "../workflow/index.js";
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
  assignedRole: string | null;
  /** Developer level currently assigned. */
  assignedLevel: string | null;
  /** User name of the currently assigned human owner. */
  owner: string | null;
  /** Override review policy for this issue. */
  reviewPolicy: ReviewPolicy | null;
  /** Override test policy for this issue. */
  testPolicy: TestPolicy | null;
  /** Overridden notify destination for this issue. */
  notifyTarget: NotifyBindingRef | null;
  /** Active session worker details. */
  activeWorker: ActiveIssueWorker | null;
  /** ISO timestamp when managed state was created. */
  createdAt: string;
  /** ISO timestamp of the last state update. */
  updatedAt: string;
  /** ISO timestamp when the issue was closed. */
  closedAt: string | null;
  /** Pending confirmation state when the provider no longer returns this issue. */
  providerMissing: ProviderMissingState | null;
  /** Terminal notification delivery marker used for deduplication. */
  pipelineNotification: PipelineNotificationState | null;
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
  /** Current retention state of associated files. */
  attachmentDisposition: AttachmentDisposition;
  /** SHA-256 of the active runtime snapshot used to create this record. */
  sourceSnapshotHash: string;
};
