/** Archive commands, queries, and retention application contracts. */

import type { ArchivedIssueRecord, IssueArchiveReason, WorkflowConfig } from "../../../domain/index.js";

/** Optional provider snapshot enriching an archive record without making provider data authoritative. */
export type ArchiveIssueSnapshot = {
  /** Last known provider title retained for operator context. */
  title?: string;
  /** Last known provider URL retained after archival. */
  issueUrl?: string;
};

/** Result of one archive attempt. */
export type ArchiveIssueResult = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Whether archival completed for the selected issue. */
  archived: boolean;
  /** Fresh eligibility refusal or operator-supplied explanation. */
  reason?: string;
  /** Committed archive record when archival succeeded. */
  record?: ArchivedIssueRecord;
};

/** Fresh-state archival request shared by completion, recovery, and explicit deletion. */
export type ArchiveIssueInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Domain reason the issue leaves active runtime state. */
  archiveReason: IssueArchiveReason;
  /** Optional provider display data, never used as runtime authority. */
  snapshot?: ArchiveIssueSnapshot;
  /** Timestamp when provider absence was confirmed. */
  providerDeletedAt?: string;
  /** Operator or service identity recorded in audit. */
  actor: string;
  /** Identity linking all checkpoints of this operation. */
  correlationId: string;
  /** Resolved project workflow including custom terminal states. */
  workflow?: WorkflowConfig;
};

/** Retention windows evaluated at a fixed planning time. */
export type ArchiveExpiryInput = {
  /** Retention window for ordinarily archived issues. */
  archiveRetention: string;
  /** Retention window for confirmed provider-deleted tombstones. */
  deletedProviderRetention: string;
  /** Fixed millisecond timestamp used to evaluate expiry. */
  now: number;
};

/** Explicit archive purge request; previews perform no mutation. */
export type PurgeIssueArchiveInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Retention window for ordinarily archived issues. */
  archiveRetention: string;
  /** Retention window for confirmed provider-deleted tombstones. */
  deletedProviderRetention: string;
  /** Non-negative maximum records selected in one bounded pass. */
  maxItems: number;
  /** Explicit permission to execute the previously planned operation. */
  apply: boolean;
  /** Operator or service identity recorded in audit. */
  actor: string;
  /** Identity linking all checkpoints of this operation. */
  correlationId: string;
};

/** Bounded periodic retention request. */
export type MaintainIssueArchiveInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Retention window for ordinarily archived issues. */
  archiveRetention: string;
  /** Retention window for confirmed provider-deleted tombstones. */
  deletedProviderRetention: string;
  /** Independent attachment window; record expiry still requires file cleanup. */
  attachmentsRetention: string;
  /** Non-negative maximum records selected in one bounded pass. */
  maxItems: number;
};

/** Completed mutations only; skipped stale records are absent. */
export type ArchiveMaintenanceResult = {
  /** Issue IDs whose attachment cleanup completed. */
  attachmentsPurged: number[];
  /** Issue IDs removed only after attachment cleanup completed. */
  recordsPurged: number[];
};

/** Planned identities in preview, successfully removed identities on apply. */
export type ArchivePurgeResult = {
  /** Whether this invocation previews the operation without applying it. */
  dryRun: boolean;
  /** Selected issue IDs in preview or successfully purged IDs on apply. */
  purge: number[];
};

/** Input to getIssueArchiveStatus using resolved project dependencies. */
export type ArchiveStatusInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Retention window for ordinarily archived issues. */
  archiveRetention: string;
  /** Retention window for confirmed provider-deleted tombstones. */
  deletedProviderRetention: string;
  /** Resolved project workflow including custom terminal states. */
  workflow?: WorkflowConfig;
};

/** Result of getIssueArchiveStatus for callers and operator diagnostics. */
export type ArchiveStatusResult = {
  /** Number of authoritative active issue records. */
  active: number;
  /** Terminal records still present in the active store. */
  terminalWaitingArchive: number;
  /** Number of archived issue records. */
  archived: number;
  /** Number of confirmed provider-deleted archive records. */
  providerDeleted: number;
  /** Records whose configured retention window has expired. */
  purgeEligible: number;
  /** Total indexed bytes retained for archived issues. */
  attachmentsRetainedBytes: number;
};

/** Input to recoverTerminalIssueArchives using resolved project dependencies. */
export type ArchiveRecoveryInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Resolved project workflow including custom terminal states. */
  workflow: WorkflowConfig;
  /** Non-negative maximum records selected in one bounded pass. */
  maxItems: number;
  /** Operator or service identity recorded in audit. */
  actor?: string;
};

/** Result of recoverTerminalIssueArchives for callers and operator diagnostics. */
export type ArchiveRecoveryResult = {
  /** Issue IDs successfully archived during this recovery pass. */
  archived: number[];
  /** Selected issues for which no requested mutation was applied. */
  skipped: SkippedArchiveIssue[];
};

/** One recovery candidate blocked by a fresh eligibility check. */
type SkippedArchiveIssue = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Fresh eligibility refusal or operator-supplied explanation. */
  reason: string;
};
