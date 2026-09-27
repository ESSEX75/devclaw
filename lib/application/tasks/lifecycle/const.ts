/** Task lifecycle audit protocol and bounded content previews. */

/** Audit event names for explicit operator lifecycle commands. */
export const TASK_EVENT = {
  EDIT_BODY: "task_edit_body",
  EDIT_BODY_WARNING: "task_edit_body_warning",
  SET_LEVEL: "task_set_level",
  START: "task_start",
} as const;

/** Maximum characters from each edited value recorded in audit. */
export const TASK_EDIT_PREVIEW_LENGTH = 200;

/** Reconciliation attribution for explicit ownership transfer. */
export const TASK_CLAIM_OWNER = "task_owner";
