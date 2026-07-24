import type { SoftUnion } from "../../types.js";
import {
  ACTION,
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  EXECUTION_MODE,
  REVIEW_CHECK,
  REVIEW_POLICY,
  ROUTING_LABELS,
  STATE_TYPE,
  TEST_POLICY,
  WORKFLOW_EVENT,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
} from "./const.js";

/** Internal system key for a workflow state (e.g. "planning", "todo"). */
export type WorkflowStateKey = SoftUnion<typeof WORKFLOW_STATE_KEYS>;

/** Display label for a workflow state, often mirrored on the provider (e.g. "To Do"). */
export type WorkflowLabel = SoftUnion<typeof WORKFLOW_STATE_LABELS>;

/** Unique identifier for a role (e.g. "developer", "tester"). */
export type RoleId = SoftUnion<typeof DEFAULT_ROLES>;

/** Unique identifier for a developer tier/level (e.g. "junior", "senior"). */
export type LevelId = SoftUnion<typeof DEFAULT_LEVELS>;

/** Union type for built-in state types. */
export type StateType = SoftUnion<typeof STATE_TYPE>;

/** Union type for execution mode. */
export type ExecutionMode = SoftUnion<typeof EXECUTION_MODE>;

/** Union type for review policy. */
export type ReviewPolicy = SoftUnion<typeof REVIEW_POLICY>;

/** Union type for test policy. */
export type TestPolicy = SoftUnion<typeof TEST_POLICY>;

/** Union type for workflow events. */
export type WorkflowEvent = SoftUnion<typeof WORKFLOW_EVENT>;

/** Role identifier. Built-in: "developer", "tester", "architect". Extensible via config. */
export type Role = SoftUnion<typeof DEFAULT_ROLES>;

/** Action identifier. Built-in actions listed in `ACTION`; custom actions are also valid strings. */
export type TransitionAction = SoftUnion<typeof ACTION>;

/** Union of possible PR review check types. */
type ReviewCheckType = SoftUnion<typeof REVIEW_CHECK>;

/** Union of possible routing label strings. */
export type RoutingLabel = SoftUnion<typeof ROUTING_LABELS>;

/** Target state name or configuration details for a state transition. */
type TransitionTarget = WorkflowStateKey | {
  target: WorkflowStateKey;
  actions?: TransitionAction[];
  description?: string;
};

/** Configuration for a single state in the workflow statechart. */
export type StateConfig = {
  type: StateType;
  role?: Role;
  label: WorkflowLabel;
  color: string;
  priority?: number;
  description?: string;
  check?: ReviewCheckType;
  on?: Record<string, TransitionTarget>;
};

/** Full workflow statechart configuration. */
export type WorkflowConfig = {
  initial: WorkflowStateKey;
  reviewPolicy?: ReviewPolicy;
  testPolicy?: TestPolicy;
  roleExecution?: ExecutionMode;
  /** Default max workers per level across all roles. Default: 2. */
  maxWorkersPerLevel?: number;
  states: Record<string, StateConfig>;
};

/** Rule mapping a specific completion scenario to the next state and actions. */
export type CompletionRule = {
  from: WorkflowLabel;
  to: WorkflowLabel;
  actions: TransitionAction[];
};

/** Definition of a role including its active levels. */
export type RoleDefinition = {
  levels: string[];
  enabled?: boolean;
};
