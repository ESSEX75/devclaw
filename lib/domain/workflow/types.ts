/**
 * workflow/types.ts — Domain types for workflow statecharts, transitions, and role definitions.
 */
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

/** Union type for built-in state types (e.g. queue, active, hold, terminal). */
export type StateType = SoftUnion<typeof STATE_TYPE>;

/** Union type for execution mode (parallel or sequential). */
export type ExecutionMode = SoftUnion<typeof EXECUTION_MODE>;

/** Union type for review policy (human, agent, or skip). */
export type ReviewPolicy = SoftUnion<typeof REVIEW_POLICY>;

/** Union type for test policy (skip or agent). */
export type TestPolicy = SoftUnion<typeof TEST_POLICY>;

/** Union type for workflow transition events (e.g. PICKUP, COMPLETE). */
export type WorkflowEvent = SoftUnion<typeof WORKFLOW_EVENT>;

/** Role identifier. Built-in: "developer", "tester", "architect". Extensible via config. */
export type Role = SoftUnion<typeof DEFAULT_ROLES>;

/** Action identifier executed during transitions (e.g. gitPull, mergePr). */
export type TransitionAction = SoftUnion<typeof ACTION>;

/** Union of possible PR review check types. */
export type ReviewCheckType = SoftUnion<typeof REVIEW_CHECK>;

/** Union of possible routing label strings (e.g. review:human, test:agent). */
export type RoutingLabel = SoftUnion<typeof ROUTING_LABELS>;

/** Target state name or detailed transition configuration for an event. */
export type TransitionTarget = WorkflowStateKey | {
  /** Target workflow state key to transition to. */
  target: WorkflowStateKey;
  /** List of actions to execute during transition. */
  actions?: TransitionAction[];
  /** Optional description of why/when this transition occurs. */
  description?: string;
};

/** Configuration for a single state in the workflow statechart. */
export type StateConfig = {
  /** Behavior type of the state (queue, active, hold, terminal). */
  type: StateType;
  /** Assigned worker role responsible for this state, if any. */
  role?: Role;
  /** Provider-side display label matching this state. */
  label: WorkflowLabel;
  /** Hex color code for the state label. */
  color: string;
  /** Priority ordering for processing. */
  priority?: number;
  /** Human-readable explanation of this state's purpose. */
  description?: string;
  /** Mandatory check condition before transitioning (e.g. prApproved). */
  check?: ReviewCheckType;
  /** Map of workflow events to their transition targets. */
  on?: Partial<Record<WorkflowEvent, TransitionTarget>>;
};

/** Full workflow statechart configuration. */
export type WorkflowConfig = {
  /** Initial workflow state key for new issues. */
  initial: WorkflowStateKey;
  /** Default review policy for PRs. */
  reviewPolicy?: ReviewPolicy;
  /** Default test policy for completed PRs. */
  testPolicy?: TestPolicy;
  /** Role execution mode (parallel or sequential). */
  roleExecution?: ExecutionMode;
  /** Default max workers per level across all roles. Default: 2. */
  maxWorkersPerLevel?: number;
  /** Map of state keys to their state configurations. */
  states: Record<WorkflowStateKey, StateConfig>;
};

/** Rule mapping a specific completion scenario to the next state and actions. */
export type CompletionRule = {
  /** Source workflow label. */
  from: WorkflowLabel;
  /** Destination workflow label. */
  to: WorkflowLabel;
  /** Actions to execute upon completing transition. */
  actions: TransitionAction[];
};

/** Definition of a role including its active levels. */
export type RoleDefinition = {
  /** List of active level identifiers (e.g. ["junior", "senior"]). */
  levels: readonly LevelId[];
  /** Whether the role is enabled in the workflow pipeline. */
  enabled?: boolean;
};
