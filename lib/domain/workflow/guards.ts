/**
 * workflow/guards.ts — Type guard functions for workflow domain entities.
 */
import {
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  WORKFLOW_EVENT,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
} from "./const.js";
import type { LevelId, RoleId, WorkflowEvent, WorkflowLabel, WorkflowStateKey } from "./types.js";

/** Checks if a given string matches a known built-in RoleId. */
export function isRoleId(value: string): value is RoleId {
  return Object.values(DEFAULT_ROLES).some((role) => role === value);
}

/** Checks if a given string matches a known built-in LevelId. */
export function isLevelId(value: string): value is LevelId {
  return Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

/** Checks if a given string matches a supported workflow event. */
export function isWorkflowEvent(value: string): value is WorkflowEvent {
  return Object.values(WORKFLOW_EVENT).some((event) => event === value);
}

/** Checks if a given string matches a known WorkflowStateKey. */
export function isWorkflowStateKey(value: string): value is WorkflowStateKey {
  return Object.values(WORKFLOW_STATE_KEYS).some((stateKey) => stateKey === value);
}

/** Checks if a given string matches a known WorkflowLabel. */
export function isWorkflowLabel(value: string): value is WorkflowLabel {
  return Object.values(WORKFLOW_STATE_LABELS).some((label) => label === value);
}
