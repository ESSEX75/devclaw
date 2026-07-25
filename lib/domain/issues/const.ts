/**
 * issues/const.ts — Issue constants.
 */

/** Supported issue tracking provider constants. */
export const ISSUE_PROVIDER = {
  /** GitHub issue tracker provider. */
  GITHUB: "github",
  /** GitLab issue tracker provider. */
  GITLAB: "gitlab",
} as const;

/** Status constants of local issue state integrity relative to the provider. */
export const ISSUE_INTEGRITY_STATUS = {
  /** Projection is synchronized and valid. */
  OK: "ok",
  /** Projection state has not been initialized yet. */
  PROJECTION_UNINITIALIZED: "projection_uninitialized",
  /** Drift detected between local runtime state and provider projection. */
  PROJECTION_DRIFT: "projection_drift",
  /** Severe state or data integrity error. */
  INTEGRITY_ERROR: "integrity_error",
} as const;
