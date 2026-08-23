/**
 * workflow/guards.ts — Type guard functions for workflow domain entities.
 */
import {
  COMPLETION_RESULT,
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  WORKFLOW_EVENT,
} from "./const.js";
import type { CompletionResult, LevelId, RoleId, WorkflowEvent } from "./types.js";

/** Checks if a value matches a built-in completion result. */
export function isCompletionResult(value: unknown): value is CompletionResult {
  return typeof value === "string"
    && Object.values(COMPLETION_RESULT).some((result) => result === value);
}

/** Checks if a value matches a built-in role identifier. */
export function isBuiltInRoleId(value: unknown): value is RoleId {
  return typeof value === "string"
    && Object.values(DEFAULT_ROLES).some((role) => role === value);
}

/** Checks if a value matches a built-in level identifier. */
export function isBuiltInLevelId(value: unknown): value is LevelId {
  return typeof value === "string"
    && Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

/** Checks if a value matches a supported workflow event. */
export function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  return typeof value === "string"
    && Object.values(WORKFLOW_EVENT).some((event) => event === value);
}
