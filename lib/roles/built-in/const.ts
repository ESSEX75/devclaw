/** Owns built-in model identifiers and the generic role announcement fallback. */

/** Explicit models used only when building the lowest-precedence configuration layer. */
export const BUILT_IN_MODELS = {
  FAST: "anthropic/claude-haiku-4-5",
  BALANCED: "anthropic/claude-sonnet-4-5",
  DEEP: "anthropic/claude-opus-4-6",
} as const;

/** Announcement marker for configured roles without a built-in fallback. */
export const DEFAULT_ROLE_EMOJI = "📋";
