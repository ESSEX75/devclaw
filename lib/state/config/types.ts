/**
 * config/types.ts — Types for the unified DevClaw configuration.
 *
 * A single workflow.yaml combines structured role levels and workflow behavior.
 * Three-layer resolution: built-in → workspace → per-project.
 */
import type {
  CompletionEventMap,
  ReviewCheckType,
  RoleLevelDefinition,
  TransitionTarget,
  WorkflowConfig,
  WorkflowEvent,
  WorkflowStateConfig,
} from "../../domain/index.js";

/** Sparse level configuration accepted from one workflow.yaml layer. */
export type LevelOverride = {
  /** Relative capability rank; larger values represent more capable workers. */
  rank?: number;
  /** Model identifier assigned to the level. */
  model?: string;
  /** Optional per-level concurrency override. */
  maxWorkers?: number;
  /** Optional announcement emoji. */
  emoji?: string;
};

/**
 * Role override in workflow.yaml. Built-in roles may inherit omitted fields,
 * while a custom role must resolve to a complete definition.
 */
export type RoleOverride = {
  /** Whether orchestration may dispatch work to the role. */
  enabled?: boolean;
  /** Level definitions keyed by identifier; false removes an inherited level. */
  levels?: Record<string, LevelOverride | false>;
  /** Level selected when issue complexity is neither explicitly simple nor complex. */
  defaultLevel?: string;
  /** Completion result to workflow event mappings. */
  completion?: CompletionEventMap;
};

/**
 * State override in workflow.yaml. Overrides specific state properties
 * or adds custom state definitions to the workflow.
 */
export type StateOverride = {
  /** State category determining execution semantics (e.g. queue, active, hold, terminal). */
  type?: WorkflowStateConfig["type"];
  /** Worker role responsible for processing issues in this state. */
  role?: string;
  /** Provider-side display label matching this state. */
  label?: string;
  /** Hex color code for the state label. */
  color?: string;
  /** Human-readable explanation of this state's purpose. */
  description?: string;
  /** Mandatory review gate or quality check required before transition. */
  check?: ReviewCheckType;
  /** Dispatch priority ordering for queue states. */
  priority?: number;
  /** Event-driven transition targets mapping workflow events to target states. */
  on?: Partial<Record<WorkflowEvent, TransitionTarget<string>>>;
};

/**
 * Workflow override in workflow.yaml. Customizes global workflow settings
 * and state definitions over built-in defaults.
 */
type WorkflowOverride = Omit<Partial<WorkflowConfig>, "states"> & {
  /** Custom or overridden workflow states keyed by state identifier. */
  states?: Record<string, StateOverride>;
};

/**
 * Configurable timeout values (in milliseconds).
 * All fields optional — defaults applied at resolution time.
 */
type TimeoutConfig = {
  /** Maximum duration allowed for a Git pull operation. */
  gitPullMs?: number;
  /** Maximum duration allowed for an OpenClaw gateway request. */
  gatewayMs?: number;
  /** Maximum duration allowed for patching a worker session. */
  sessionPatchMs?: number;
  /** Maximum duration allowed for dispatching worker execution. */
  dispatchMs?: number;
  /** Age after which an active worker may be treated as stale. */
  staleWorkerHours?: number;
  /** Context budget ratio (0-1). Clear session when context exceeds this fraction of the context window. Default: 0.6 */
  sessionContextBudget?: number;
  /** Minutes of session inactivity before stall detection kicks in. Default: 15 */
  stallTimeoutMinutes?: number;
};

/** Retention and bounded heartbeat maintenance for the dedicated issue archive. */
type IssueArchiveMaintenanceConfig = {
  /** Retention duration for records whose provider issue was deleted. */
  deletedProviderRetention?: string;
  /** General retention duration for archived issue records. */
  archiveRetention?: string;
  /** Retention duration for attachments belonging to archived issues. */
  attachmentsRetention?: string;
  /** Maximum archived records processed during one heartbeat pass. */
  maxPerHeartbeat?: number;
};

/** Fully resolved archive maintenance policy. */
type ResolvedIssueArchiveMaintenance = {
  /** Effective retention duration for records whose provider issue was deleted. */
  deletedProviderRetention: string;
  /** Effective general retention duration for archived issue records. */
  archiveRetention: string;
  /** Effective retention duration for attachments belonging to archived issues. */
  attachmentsRetention: string;
  /** Effective maximum archived records processed during one heartbeat pass. */
  maxPerHeartbeat: number;
};

/**
 * Instance identity config. Optional — auto-generated if not set.
 */
type InstanceConfig = {
  /** Override the auto-generated instance name (CS pioneer name). */
  name?: string;
};

/**
 * The full workflow.yaml shape.
 * All fields optional — missing fields inherit from the layer below.
 */
export type DevClawConfig = {
  /** Sparse role definitions keyed by configured role identifier. */
  roles?: Record<string, RoleOverride | false>;
  /** Sparse workflow definition layered over lower-precedence configuration. */
  workflow?: WorkflowOverride;
  /** Optional runtime timeout overrides. */
  timeouts?: TimeoutConfig;
  /** Optional instance identity override. */
  instance?: InstanceConfig;
  /** Optional archive maintenance overrides. */
  issueArchiveMaintenance?: IssueArchiveMaintenanceConfig;
};

/**
 * Fully resolved timeout config — all fields present with defaults.
 */
export type ResolvedTimeouts = {
  /** Effective maximum duration allowed for a Git pull operation. */
  gitPullMs: number;
  /** Effective maximum duration allowed for an OpenClaw gateway request. */
  gatewayMs: number;
  /** Effective maximum duration allowed for patching a worker session. */
  sessionPatchMs: number;
  /** Effective maximum duration allowed for dispatching worker execution. */
  dispatchMs: number;
  /** Effective age after which an active worker may be treated as stale. */
  staleWorkerHours: number;
  /** Context budget ratio (0-1). Clear session when context exceeds this fraction of the context window. Default: 0.6 */
  sessionContextBudget: number;
  /** Minutes of session inactivity before stall detection kicks in. Default: 15 */
  stallTimeoutMinutes: number;
};

/**
 * Fully resolved config — all fields guaranteed present.
 * Built by merging three layers over the built-in defaults.
 */
export type ResolvedConfig = {
  /** Complete role definitions keyed by configured role identifier. */
  roles: Record<string, ResolvedRoleConfig>;
  /** Complete validated workflow used by application orchestration. */
  workflow: WorkflowConfig;
  /** Complete timeout policy with all defaults applied. */
  timeouts: ResolvedTimeouts;
  /** Instance name override from config. Undefined = use auto-generated from instance.json. */
  instanceName?: string;
  /** Complete archive maintenance policy with all defaults applied. */
  issueArchiveMaintenance: ResolvedIssueArchiveMaintenance;
};

/** Complete runtime configuration for one active worker level. */
export type ResolvedLevelConfig = RoleLevelDefinition & {
  /** Maximum concurrent workers for the level. */
  maxWorkers: number;
};

/** Fully resolved role configuration used by runtime orchestration. */
export type ResolvedRoleConfig = {
  /** Complete active level definitions keyed by identifier. */
  levels: Record<string, ResolvedLevelConfig>;
  /** Level used for tasks with no explicit complexity signal. */
  defaultLevel: string;
  /** Completion result to workflow event mappings. */
  completion: CompletionEventMap;
  /** Whether orchestration may dispatch work to the role. */
  enabled: boolean;
};
