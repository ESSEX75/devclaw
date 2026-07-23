import {
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
} from "./const.js";
import type { LevelId, RoleId, WorkflowLabel, WorkflowStateKey } from "./types.js";

export function isRoleId(value: string): value is RoleId {
  return Object.values(DEFAULT_ROLES).some((role) => role === value);
}

export function isLevelId(value: string): value is LevelId {
  return Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

export function isWorkflowStateKey(value: string): value is WorkflowStateKey {
  return Object.values(WORKFLOW_STATE_KEYS).some((stateKey) => stateKey === value);
}

export function isWorkflowLabel(value: string): value is WorkflowLabel {
  return Object.values(WORKFLOW_STATE_LABELS).some((label) => label === value);
}
