/** Archive eligibility reasons, audit protocol, and retention units. */

/** Conditions that prevent transfer from active state. */
export const ARCHIVE_BLOCK_REASON = {
  ACTIVE_WORKER: "active_worker",
  WORKER_SLOT: "worker_slot",
  NOTIFICATION_PENDING: "notification_pending",
  NOT_TERMINAL: "not_terminal",
  NOT_FOUND: "not_found",
  ALREADY_ARCHIVED: "already_archived",
} as const;

/** Archive audit events; planned deletion is recorded before bytes are removed. */
export const ARCHIVE_EVENT = {
  ARCHIVED: "issue_archived",
  PROVIDER_DELETED: "issue_provider_deleted_archived",
  ATTACHMENTS_PLANNED: "issue_attachments_purge_planned",
  ATTACHMENTS_PURGED: "issue_attachments_purged",
  PURGED: "issue_archive_purged",
} as const;

/** Actor identity for bounded archive maintenance. */
export const ARCHIVE_MAINTENANCE_ACTOR = "heartbeat_archive_maintenance";

/** Actor identity for recovering interrupted terminal archival. */
export const ARCHIVE_RECOVERY_ACTOR = "heartbeat_archive_recovery";

/** Source snapshot digest algorithm. */
export const ARCHIVE_HASH_ALGORITHM = "sha256";

/** Millisecond conversion factors accepted by strict retention parsing. */
export const DURATION_MULTIPLIERS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Entire non-negative integral duration including its unit. */
export const RETENTION_DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

/** Audit reasons for the selected retention policy. */
export const RETENTION_REASON = { ARCHIVE: "archive_retention", ATTACHMENTS: "attachments_retention" } as const;
