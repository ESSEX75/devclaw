/** Stable command protocol and result identifiers for policy operations. */

/** Reasons a policy migration skips an issue. */
export const POLICY_SKIP_REASON = {
  ACTIVE_WORKER: "active_worker",
  CLOSED: "closed",
  NO_CHANGE: "no_change",
  STATE_CHANGED: "state_changed",
  NOT_FOUND: "not_found",
} as const;

/** Audit and reconciliation identities for policy migration. */
export const POLICY_EVENT = {
  OWNER: "issue_policy_migrate",
  MIGRATED: "issue_policy_migration",
} as const;
