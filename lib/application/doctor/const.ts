/** Owns doctor-specific diagnostic identifiers; route codes remain owned by setup. */

/** Severity determines whether the full doctor inspection can report success. */
export const DOCTOR_SEVERITY = {
  ERROR: "error",
  INFO: "info",
} as const;

/** Stable findings owned by doctor rather than the underlying route validator. */
export const DOCTOR_FINDING_CODE = {
  ROUTING_OK: "routing.ok",
  OWNER_TOOLS_INCOMPLETE: "isolation.owner_tools_incomplete",
  FOREIGN_AGENT_TOOLS_VISIBLE: "isolation.foreign_agent_tools_visible",
  RETENTION_ORDER: "archive.retention_order",
  ARCHIVE_INSPECTION_FAILED: "archive.inspection_failed",
} as const;
