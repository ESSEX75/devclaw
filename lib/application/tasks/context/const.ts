/** Worker message size policy. */

/** Additional count cap applied after accounting for the worker input size. */
export const TASK_COMMENT_LIMIT = 20;

/** Estimated input allowance; reserved capacity is unavailable to task discussion. */
export const TASK_CONTEXT_BUDGET = {
  MAX_INPUT_TOKENS: 24_000,
  RESERVED_TOKENS: 4_000,
} as const;
