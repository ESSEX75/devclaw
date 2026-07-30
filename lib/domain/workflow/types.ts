/**
 * workflow/types.ts — Domain types for workflow statecharts, transitions, and role definitions.
 */
import type { SoftUnion } from "../../types.js";
import {
  ACTION,
  COMPLETION_RESULT,
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

/** Built-in worker completion result identifier. */
export type CompletionResult = SoftUnion<typeof COMPLETION_RESULT>;

/** Explicit mapping from role completion results to workflow events. */
export type CompletionEventMap<TResult extends string = string> =
  Readonly<Record<TResult, WorkflowEvent>>;

/** Action identifier executed during transitions (e.g. gitPull, mergePr). */
export type TransitionAction = SoftUnion<typeof ACTION>;

/** Union of possible PR review check types. */
export type ReviewCheckType = SoftUnion<typeof REVIEW_CHECK>;

/** Union of possible routing label strings (e.g. review:human, test:agent). */
export type RoutingLabel = SoftUnion<typeof ROUTING_LABELS>;

/** Configuration for a workflow event transition. */
export type TransitionTarget<TStateKey extends string = WorkflowStateKey> = {
  /** Target workflow state key to transition to. */
  target: TStateKey;
  /** List of actions to execute during transition. */
  actions?: TransitionAction[];
  /** Optional description of why/when this transition occurs. */
  description?: string;
};

/** Fields shared by every workflow state. */
type BaseStateConfig<TLabel extends string> = {
  /** Provider-side display label matching this state. */
  label: TLabel;
  /** Hex color code for the state label. */
  color: string;
  /** Human-readable explanation of this state's purpose. */
  description?: string;
  /** Mandatory check condition before transitioning (e.g. prApproved). */
  check?: ReviewCheckType;
};

/** Outgoing transitions supported by non-terminal workflow states. */
type StatefulTransitions<TStateKey extends string> = {
  /** Map of workflow events to their transition targets. */
  on?: Partial<Record<WorkflowEvent, TransitionTarget<TStateKey>>>;
};

/** Queue state waiting for a role to pick up work. */
export type QueueStateConfig<
  TRoleId extends string = RoleId,
  TStateKey extends string = WorkflowStateKey,
  TLabel extends string = WorkflowLabel,
> = BaseStateConfig<TLabel> & StatefulTransitions<TStateKey> & {
  /** Queue behavior discriminator. */
  type: typeof STATE_TYPE.QUEUE;
  /** Worker role responsible for this queue. */
  role: TRoleId;
  /** Priority ordering for processing. */
  priority?: number;
};

/** Active state currently processed by a worker role. */
export type ActiveStateConfig<
  TRoleId extends string = RoleId,
  TStateKey extends string = WorkflowStateKey,
  TLabel extends string = WorkflowLabel,
> = BaseStateConfig<TLabel> & StatefulTransitions<TStateKey> & {
  /** Active behavior discriminator. */
  type: typeof STATE_TYPE.ACTIVE;
  /** Worker role responsible for active processing. */
  role: TRoleId;
  /** Priority is meaningful only for queue states. */
  priority?: never;
};

/** Hold state waiting for an external or human decision. */
export type HoldStateConfig<
  TStateKey extends string = WorkflowStateKey,
  TLabel extends string = WorkflowLabel,
> = BaseStateConfig<TLabel> & StatefulTransitions<TStateKey> & {
  /** Hold behavior discriminator. */
  type: typeof STATE_TYPE.HOLD;
  /** Hold states are not assigned to worker roles. */
  role?: never;
  /** Priority is meaningful only for queue states. */
  priority?: never;
};

/** Terminal state concluding the workflow. */
export type TerminalStateConfig<
  TLabel extends string = WorkflowLabel,
> = BaseStateConfig<TLabel> & {
  /** Terminal behavior discriminator. */
  type: typeof STATE_TYPE.TERMINAL;
  /** Terminal states are not assigned to worker roles. */
  role?: never;
  /** Priority is meaningful only for queue states. */
  priority?: never;
  /** Terminal states cannot have outgoing transitions. */
  on?: never;
};

/** Configuration for a single state in the workflow statechart. */
export type StateConfig<
  TRoleId extends string = RoleId,
  TStateKey extends string = WorkflowStateKey,
  TLabel extends string = WorkflowLabel,
> =
  | QueueStateConfig<TRoleId, TStateKey, TLabel>
  | ActiveStateConfig<TRoleId, TStateKey, TLabel>
  | HoldStateConfig<TStateKey, TLabel>
  | TerminalStateConfig<TLabel>;

/** Full workflow statechart configuration. */
export type WorkflowConfig<
  TRoleId extends string = RoleId,
  TStateKey extends string = WorkflowStateKey,
  TLabel extends string = WorkflowLabel,
> = {
  /** Initial workflow state key for new issues. */
  initial: TStateKey;
  /** Default review policy for PRs. */
  reviewPolicy?: ReviewPolicy;
  /** Default test policy for completed PRs. */
  testPolicy?: TestPolicy;
  /** Role execution mode (parallel or sequential). */
  roleExecution?: ExecutionMode;
  /** Default max workers per level across all roles. Default: 2. */
  maxWorkersPerLevel?: number;
  /** Map of state keys to their state configurations. */
  states: Record<TStateKey, StateConfig<TRoleId, TStateKey, TLabel>>;
};

/** Role identifier validated from the resolved runtime configuration. */
export type ConfiguredRoleId = string;

/** Level identifier validated within a configured role definition. */
export type ConfiguredLevelId = string;

/** State identifier validated within the resolved workflow configuration. */
export type ConfiguredWorkflowStateKey = string;

/** Provider label validated within the resolved workflow configuration. */
export type ConfiguredWorkflowLabel = string;

/** Workflow configuration after all built-in and user layers are resolved. */
export type ResolvedWorkflowConfig = WorkflowConfig<
  ConfiguredRoleId,
  ConfiguredWorkflowStateKey,
  ConfiguredWorkflowLabel
>;

/** State configuration belonging to a resolved runtime workflow. */
export type ResolvedStateConfig = StateConfig<
  ConfiguredRoleId,
  ConfiguredWorkflowStateKey,
  ConfiguredWorkflowLabel
>;

/** Rule mapping a specific completion scenario to the next state and actions. */
export type CompletionRule<TLabel extends string = WorkflowLabel> = {
  /** Source workflow label. */
  from: TLabel;
  /** Destination workflow label. */
  to: TLabel;
  /** Actions to execute upon completing transition. */
  actions: TransitionAction[];
};

/** Definition of a role including its active levels. */
export type RoleDefinition<TLevelId extends string = LevelId> = {
  /** List of active level identifiers (e.g. ["junior", "senior"]). */
  levels: readonly TLevelId[];
  /** Whether the role is enabled in the workflow pipeline. */
  enabled?: boolean;
};
