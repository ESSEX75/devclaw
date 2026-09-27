/** Stable command protocol and result identifiers for deletion operations. */

/** Audit checkpoints around explicit provider deletion. */
export const DELETE_EVENT = {
  REQUESTED: "issue_delete_requested",
  PROVIDER_SUCCEEDED: "issue_delete_provider_succeeded",
  PROVIDER_FAILED: "issue_delete_provider_failed",
} as const;

/** Audit attribution for requested and failed deletion. */
export const DELETE_REASON = {
  EXPLICIT_REQUEST: "explicit_user_request",
  PROVIDER_FAILED: "provider_delete_failed",
} as const;
