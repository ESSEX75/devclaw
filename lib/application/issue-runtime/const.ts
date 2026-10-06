/** Owns runtime-resolution discriminants. */

/** Distinguishes authoritative records from read-only provider observations. */
export const ISSUE_RUNTIME_KIND = {
  MANAGED: "managed",
  UNINITIALIZED: "uninitialized",
} as const;
