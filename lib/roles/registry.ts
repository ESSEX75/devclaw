/**
 * roles/registry.ts — Single source of truth for all worker roles.
 *
 * Adding a new role? Just add an entry here. Everything else derives from this.
 *
 * Each role defines:
 * - Identity (id, displayName)
 * - Levels and models
 * - Emoji for announcements
 * - Valid completion results
 * - Session key matching
 * - Notification preferences
 */
import { COMPLETION_RESULT, type RoleId, WORKFLOW_EVENT } from "../domain/index.js";
import type { RoleConfig } from "./types.js";

export const ROLE_REGISTRY: Record<RoleId, RoleConfig> = {
  developer: {
    id: "developer",
    displayName: "DEVELOPER",
    levels: ["junior", "medior", "senior"],
    defaultLevel: "medior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      medior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
    },
    emoji: {
      junior: "⚡",
      medior: "🔧",
      senior: "🧠",
    },
    fallbackEmoji: "🔧",
    completion: {
      [COMPLETION_RESULT.DONE]: WORKFLOW_EVENT.COMPLETE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
    sessionKeyPattern: "developer",
    notifications: { onStart: true, onComplete: true },
  },

  tester: {
    id: "tester",
    displayName: "TESTER",
    levels: ["junior", "medior", "senior"],
    defaultLevel: "medior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      medior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
    },
    emoji: {
      junior: "⚡",
      medior: "🔍",
      senior: "🧠",
    },
    fallbackEmoji: "🔍",
    completion: {
      [COMPLETION_RESULT.PASS]: WORKFLOW_EVENT.PASS,
      [COMPLETION_RESULT.FAIL]: WORKFLOW_EVENT.FAIL,
      [COMPLETION_RESULT.REFINE]: WORKFLOW_EVENT.REFINE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
    sessionKeyPattern: "tester",
    notifications: { onStart: true, onComplete: true },
  },

  architect: {
    id: "architect",
    displayName: "ARCHITECT",
    levels: ["junior", "senior"],
    defaultLevel: "junior",
    models: {
      junior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
    },
    emoji: {
      junior: "📐",
      senior: "🏗️",
    },
    fallbackEmoji: "🏗️",
    completion: {
      [COMPLETION_RESULT.DONE]: WORKFLOW_EVENT.COMPLETE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
    sessionKeyPattern: "architect",
    notifications: { onStart: true, onComplete: true },
  },

  reviewer: {
    id: "reviewer",
    displayName: "REVIEWER",
    levels: ["junior", "senior"],
    defaultLevel: "junior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      senior: "anthropic/claude-sonnet-4-5",
    },
    emoji: {
      junior: "👁️",
      senior: "🔬",
    },
    fallbackEmoji: "👁️",
    completion: {
      [COMPLETION_RESULT.APPROVE]: WORKFLOW_EVENT.APPROVE,
      [COMPLETION_RESULT.REJECT]: WORKFLOW_EVENT.REJECT,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
    sessionKeyPattern: "reviewer",
    notifications: { onStart: true, onComplete: true },
  },
};
