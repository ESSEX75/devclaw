/**
 * issues/const.ts — Issue constants.
 */

export const ISSUE_PROVIDER = {
  GITHUB: "github",
  GITLAB: "gitlab",
} as const;

export const ISSUE_INTEGRITY_STATUS = {
  OK: "ok",
  PROJECTION_UNINITIALIZED: "projection_uninitialized",
  PROJECTION_DRIFT: "projection_drift",
  INTEGRITY_ERROR: "integrity_error",
} as const;
