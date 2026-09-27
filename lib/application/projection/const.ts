/** Identifies label-reconciliation diagnostics and its audit protocol. */

/** Only diagnostics with this prefix belong to label reconciliation and may be cleared by it. */
export const PROJECTION_FAILURE_PREFIX = "managed projection failed for ";

/** Audit events report verified labels separately from overall issue integrity. */
export const PROJECTION_EVENT = { RECONCILED: "issue_projection_reconciled" } as const;
