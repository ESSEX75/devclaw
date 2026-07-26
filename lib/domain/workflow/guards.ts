/**
 * workflow/guards.ts — Type guard functions for workflow domain entities.
 */
import {
  COMPLETION_RESULT,
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  WORKFLOW_EVENT,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
} from "./const.js";
import type { CompletionResult, LevelId, RoleId, WorkflowEvent, WorkflowLabel, WorkflowStateKey } from "./types.js";

/** Checks if a value matches a built-in completion result. */
export function isCompletionResult(value: unknown): value is CompletionResult {
  return typeof value === "string"
    && Object.values(COMPLETION_RESULT).some((result) => result === value);
}

/** Checks if a value matches a known built-in RoleId. */
export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string"
    && Object.values(DEFAULT_ROLES).some((role) => role === value);
}

/** Checks if a value matches a known built-in LevelId. */
export function isLevelId(value: unknown): value is LevelId {
  return typeof value === "string"
    && Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

/** Checks if a value matches a supported workflow event. */
export function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  return typeof value === "string"
    && Object.values(WORKFLOW_EVENT).some((event) => event === value);
}

/** Checks if a value matches a known WorkflowStateKey. */
export function isWorkflowStateKey(value: unknown): value is WorkflowStateKey {
  return typeof value === "string"
    && Object.values(WORKFLOW_STATE_KEYS).some((stateKey) => stateKey === value);
}

/** Checks if a value matches a known WorkflowLabel. */
export function isWorkflowLabel(value: unknown): value is WorkflowLabel {
  return typeof value === "string"
    && Object.values(WORKFLOW_STATE_LABELS).some((label) => label === value);
}
