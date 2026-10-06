/** Owns built-in model identifiers, announcement fallback, and task-complexity policy. */

/** Explicit models used only when building the lowest-precedence configuration layer. */
export const BUILT_IN_MODELS = {
  FAST: "anthropic/claude-haiku-4-5",
  BALANCED: "anthropic/claude-sonnet-4-5",
  DEEP: "anthropic/claude-opus-4-6",
} as const;

/** Announcement marker for configured roles without a built-in fallback. */
export const DEFAULT_ROLE_EMOJI = "📋";

/** Explicit complexity signals supported by configured level selection. */
export const TASK_COMPLEXITY = {
  SIMPLE: "simple",
  MEDIUM: "medium",
  COMPLEX: "complex",
} as const;

/** Upper exclusive word-count limit for a simple textual signal. */
export const SIMPLE_TASK_WORD_LIMIT = 100;

/** Lower exclusive word-count limit for a complex description. */
export const COMPLEX_TASK_WORD_LIMIT = 500;

/** Whole words and phrases that identify routine changes in short descriptions. */
export const SIMPLE_TASK_KEYWORDS = [
  "simple", "typo", "fix typo", "rename", "update text", "change color",
  "minor", "small", "css", "style", "copy", "wording",
] as const;

/** Whole words and phrases that require the highest configured capability rank. */
export const COMPLEX_TASK_KEYWORDS = [
  "architect", "architecture", "architectural", "refactor", "refactoring",
  "redesign", "system-wide", "migration", "database schema", "security",
  "performance", "infrastructure", "multi-service",
] as const;
