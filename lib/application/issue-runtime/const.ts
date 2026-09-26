/** Owns runtime-resolution discriminants and the version assigned to initial records. */

/** Distinguishes authoritative records from read-only provider observations. */
export const ISSUE_RUNTIME_KIND = {
  MANAGED: "managed",
  UNINITIALIZED: "uninitialized",
} as const;

//TODO Убери, не надо нам версий, проект не релизнулся
/** Projection contract version assigned when application publishes a new managed record. */
export const INITIAL_PROJECTION_VERSION = 1;
