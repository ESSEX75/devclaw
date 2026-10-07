/** Owns built-in model assignments, capability ranks, display names, and announcement markers. */

import { DEFAULT_ROLES } from "../../domain/index.js";

/** Display names for built-in roles, independent of runtime custom role identifiers. */
export const BUILT_IN_ROLE_DISPLAY_NAMES = {
  [DEFAULT_ROLES.DEVELOPER]: "DEVELOPER",
  [DEFAULT_ROLES.TESTER]: "TESTER",
  [DEFAULT_ROLES.ARCHITECT]: "ARCHITECT",
  [DEFAULT_ROLES.REVIEWER]: "REVIEWER",
} as const;

/** Ordered positions in built-in capability scales; custom ranks remain configuration-owned. */
export const BUILT_IN_LEVEL_RANK = {
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
} as const;

/** Announcement markers reused by built-in levels and role fallbacks. */
export const BUILT_IN_EMOJI = {
  QUICK: "⚡",
  DEVELOPMENT: "🔧",
  TESTING: "🔍",
  DEEP_ANALYSIS: "🧠",
  DESIGN: "📐",
  ARCHITECTURE: "🏗️",
  REVIEW: "👁️",
  DETAILED_REVIEW: "🔬",
} as const;

/** Explicit models used only when building the lowest-precedence configuration layer. */
export const BUILT_IN_MODELS = {
  FAST: "anthropic/claude-haiku-4-5",
  BALANCED: "anthropic/claude-sonnet-4-5",
  DEEP: "anthropic/claude-opus-4-6",
} as const;

/** Announcement marker for configured roles without a built-in fallback. */
export const DEFAULT_ROLE_EMOJI = "📋";
