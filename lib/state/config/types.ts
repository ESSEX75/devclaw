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

export type StateOverride = {
  type?: WorkflowConfig["states"][string]["type"];
  role?: string;
  label?: string;
  color?: string;
  description?: string;
  check?: ReviewCheckType;
  priority?: number;
  on?: Partial<Record<WorkflowEvent, TransitionTarget<string>>>;
};

type WorkflowOverride = Omit<Partial<WorkflowConfig>, "states"> & {
  states?: Record<string, StateOverride>;
};

/**
 * Configurable timeout values (in milliseconds).
 * All fields optional — defaults applied at resolution time.
 */
export type TimeoutConfig = {
  gitPullMs?: number;
  gatewayMs?: number;
  sessionPatchMs?: number;
  dispatchMs?: number;
  staleWorkerHours?: number;
  /** Context budget ratio (0-1). Clear session when context exceeds this fraction of the context window. Default: 0.6 */
  sessionContextBudget?: number;
  /** Minutes of session inactivity before stall detection kicks in. Default: 15 */
  stallTimeoutMinutes?: number;
};

/** Retention and bounded heartbeat maintenance for the dedicated issue archive. */
export type IssueArchiveMaintenanceConfig = {
  deletedProviderRetention?: string;
  archiveRetention?: string;
  attachmentsRetention?: string;
  maxPerHeartbeat?: number;
};

/** Fully resolved archive maintenance policy. */
export type ResolvedIssueArchiveMaintenance = {
  deletedProviderRetention: string;
  archiveRetention: string;
  attachmentsRetention: string;
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
export type RawConfig = {
  roles?: Record<string, RoleOverride | false>;
  workflow?: WorkflowOverride;
  timeouts?: TimeoutConfig;
  instance?: InstanceConfig;
  issueArchiveMaintenance?: IssueArchiveMaintenanceConfig;
};

type ValidatedConfig = RawConfig;
export type DevClawConfig = ValidatedConfig;

/**
 * Fully resolved timeout config — all fields present with defaults.
 */
export type ResolvedTimeouts = {
  gitPullMs: number;
  gatewayMs: number;
  sessionPatchMs: number;
  dispatchMs: number;
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
  roles: Record<string, ResolvedRoleConfig>;
  workflow: WorkflowConfig;
  timeouts: ResolvedTimeouts;
  /** Instance name override from config. Undefined = use auto-generated from instance.json. */
  instanceName?: string;
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
