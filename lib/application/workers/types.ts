/**
 * Defines the application contracts for dispatching managed issues to worker sessions.
 */

import type { RunCommand } from "../../context.js";
import type { ActiveIssueWorker, Project, RoleWorkerState, SlotState, WorkflowConfig } from "../../domain/index.js";
import { WORKER_DELIVERY_RESOLUTION, WORKER_DELIVERY_STATUS } from "../../domain/index.js";
import type { AGENT_TURN_STATUS } from "../../integrations/openclaw/const.js";
import type { SessionLookup } from "../../integrations/openclaw/gateway-sessions.js";
import type { AgentTurnOutcome } from "../../integrations/openclaw/types.js";
import type { IssueComment, IssueProvider } from "../../integrations/providers/provider.js";
import type { ResolvedConfig, ResolvedRoleConfig } from "../../state/index.js";
import type { ValueOf } from "../../types.js";
import type { NotificationCreatedTask, NotificationRuntime } from "../notifications/index.js";
import type { CompletionOutput } from "../pipeline/index.js";
import type { PrFeedback } from "../review/index.js";
import type { WORKER_SESSION_ACTION } from "./const.js";

/** Immutable inputs used to plan one worker session assignment. */
export type DispatchPlanInput = {
  /** Project whose agent and slug determine session identity. */
  project: Project;
  /** Optional explicit OpenClaw agent identity. */
  agentId?: string;
  /** Provider-local issue selected for dispatch. */
  issueId: number;
  /** Configured role selected by queue policy. */
  role: string;
  /** Configured level selected from local issue state. */
  level: string;
  /** Zero-based concrete worker slot. */
  slotIndex: number;
  /** Fresh slot snapshot before reservation. */
  slot: SlotState;
  /** Resolved role configuration for model selection. */
  resolvedRole?: ResolvedRoleConfig;
  /** Whether context budget checks require replacing the current session. */
  clearExisting: boolean;
};

/** Session identity and model chosen before any provider or state mutation. */
export type DispatchPlan = {
  /** Configured role that owns the worker slot. */
  role: string;
  /** Configured level containing the worker slot. */
  level: string;
  /** Concrete slot index within the level. */
  slotIndex: number;
  /** Resolved model for this worker session. */
  model: string;
  /** Stable human-readable worker name. */
  botName: string;
  /** Deterministic OpenClaw session identity. */
  sessionKey: string;
  /** Whether an existing matching session can be reused. */
  sessionAction: ValueOf<typeof WORKER_SESSION_ACTION>;
  /** Stale or over-budget session to remove before delivery. */
  sessionKeyToDelete: string | null;
};

/** One concrete submission, distinct from a reusable session identity. */
export type DispatchAttempt = DispatchPlan & {
  /** Unique delivery token fencing callbacks and operator decisions. */
  deliveryId: string;
  /** One timestamp shared by project and issue ownership. */
  startedAt: string;
};

/** Inputs required to reserve a worker and dispatch one managed issue. */
export type DispatchOpts = {
  /** Workspace containing project and issue state. */
  workspaceDir: string;
  /** Optional OpenClaw agent that owns the worker session. */
  agentId?: string;
  /** Registered project receiving the worker. */
  project: Project;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Current provider issue title. */
  issueTitle: string;
  /** Current provider issue description. */
  issueDescription: string;
  /** Canonical provider issue URL. */
  issueUrl: string;
  /** Configured role assigned to the task. */
  role: string;
  /** Configured role level or explicit model identifier. */
  level: string;
  /** Provider workflow label consumed by dispatch. */
  fromLabel: string;
  /** Provider workflow label applied by dispatch. */
  toLabel: string;
  /** Provider used for issue reads and mutations. */
  provider: IssueProvider;
  /** Optional plugin configuration used for notification settings. */
  pluginConfig?: Record<string, unknown>;
  /** Optional orchestrator session recorded as the worker parent. */
  sessionKey?: string;
  /** Optional OpenClaw runtime used for direct notification delivery. */
  runtime?: NotificationRuntime;
  /** Concrete worker slot selected from the fresh queue snapshot. */
  slotIndex?: number;
  /** Optional DevClaw instance claiming the issue. */
  instanceName?: string;
  /** Command runner used for OpenClaw gateway operations. */
  runCommand: RunCommand;
};

/** Stable dispatch metadata returned to queue and tool callers. */
export type DispatchResult = {
  /** Unique submission identifier used for exact operator recovery. */
  deliveryId: string;
  /** Whether dispatch created a session identity or reused an existing one. */
  sessionAction: ValueOf<typeof WORKER_SESSION_ACTION>;
  /** Deterministic OpenClaw worker session key. */
  sessionKey: string;
  /** Configured worker level selected for dispatch. */
  level: string;
  /** Resolved model assigned to the worker session. */
  model: string;
  /** Human-readable dispatch announcement. */
  announcement: string;
  /** Observed gateway result; pending and unknown retain the reservation for reconciliation. */
  deliveryStatus: Exclude<AgentTurnOutcome["kind"], typeof AGENT_TURN_STATUS.REJECTED> | typeof WORKER_DELIVERY_STATUS.PENDING;
};

/** Immediate observation and eventual settlement of one gateway submission. */
export type SessionDeliveryObservation = {
  /** Outcome seen within the brief acceptance window. */
  initial: AgentTurnOutcome | { /** The command outlived the acceptance observation window. */ kind: typeof WORKER_DELIVERY_STATUS.PENDING };
  /** Eventual gateway command outcome, which may arrive after dispatch returns. */
  settled: Promise<AgentTurnOutcome>;
};

/** Metadata written to successful dispatch audit events. */
export type AuditDispatchOptions = {
  /** Human-readable project name. */
  project: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider issue title at pickup. */
  issueTitle: string;
  /** Configured role assigned by dispatch. */
  role: string;
  /** Configured level assigned by dispatch. */
  level: string;
  /** Resolved worker model. */
  model: string;
  /** Whether the session was created or reused. */
  sessionAction: ValueOf<typeof WORKER_SESSION_ACTION>;
  /** Deterministic worker session key. */
  sessionKey: string;
  /** Workflow label consumed by dispatch. */
  fromLabel: string;
  /** Active workflow label applied by dispatch. */
  toLabel: string;
};

/** Identity needed to inspect an unresolved gateway send without rollback. */
export type UnknownDispatchInput = {
  /** Submission token supplied by callbacks; heartbeat pins the observed marker when absent. */
  deliveryId?: string;
  /** Workspace containing project and issue state. */
  workspaceDir: string;
  /** Canonical project owning the slot. */
  projectSlug: string;
  /** Configured worker role. */
  role: string;
  /** Configured worker level. */
  level: string;
  /** Concrete reserved slot index. */
  slotIndex: number;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Deterministic worker session identity. */
  sessionKey: string;
  /** Gateway command capability for session inspection. */
  runCommand: RunCommand;
  /** Transport diagnostic prompting reconciliation. */
  reason: string;
  /** Gateway session snapshot already fetched by heartbeat, if available. */
  sessions?: SessionLookup | null;
  /** Whether the gateway command has settled without a confirmed acceptance. */
  outcomeUnknown?: boolean;
};

/** Explicit, audited operator decision for a still-reserved uncertain worker turn. */
export type ResolveWorkerDeliveryInput = {
  /** Exact operation identifier from the unresolved delivery marker. */
  deliveryId: string;
  /** Workspace containing authoritative project and issue state. */
  workspaceDir: string;
  /** Canonical project owning the worker slot. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Exact session identity shown by the unresolved status. */
  sessionKey: string;
  /** Operator's verified conclusion about this worker turn. */
  decision: ValueOf<typeof WORKER_DELIVERY_RESOLUTION>;
  /** Operator's evidence or investigation note for audit. */
  reason: string;
  /** Whether to apply the decision; false previews fresh state. */
  apply: boolean;
  /** Resolved workflow used to validate a safe queue return. */
  workflow?: WorkflowConfig;
  /** Optional provider supplied by tests or an existing application caller. */
  provider?: IssueProvider;
  /** Runtime command capability used when a provider must be created. */
  runCommand?: RunCommand;
};

/** Result of previewing or applying an explicit worker delivery decision. */
export type ResolveWorkerDeliveryResult = {
  /** Concrete submission whose durable resolution was resumed. */
  deliveryId: string;
  /** Whether the decision was applied. */
  applied: boolean;
  /** Project and issue bound to the verified session. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Exact session identity affected by the decision. */
  sessionKey: string;
  /** Operator conclusion recorded for this worker turn. */
  decision: ValueOf<typeof WORKER_DELIVERY_RESOLUTION>;
  /** Previous active workflow label. */
  fromLabel: string;
  /** Queue label after confirmed non-start, or active label after confirmed start. */
  toLabel: string;
};

/** Validated worker completion request from an adapter. */
export type FinishWorkInput = {
  /** Workspace containing the project registry. */
  workspaceDir: string;
  /** Unambiguous project destination supplied by the adapter. */
  channelId: string;
  /** Configured completing role. */
  role: string;
  /** Configured completion result. */
  result: string;
  /** Worker completion summary. */
  summary?: string;
  /** Optional observed PR URL. */
  prUrl?: string;
  /** Child tasks created by the worker. */
  createdTasks?: NotificationCreatedTask[];
  /** Exact caller session when available. */
  sessionKey?: string;
  /** External command capability. */
  runCommand: RunCommand;
  /** Notification runtime capability. */
  runtime?: NotificationRuntime;
  /** Notification settings. */
  pluginConfig?: Record<string, unknown>;
};

/** Resolved finish context; the pipeline rechecks captured worker identity under its issue lock. */
export type FinishWorkContext = {
  /** Project selected without ambiguous routing. */
  project: Project;
  /** Fully resolved roles and workflow. */
  config: ResolvedConfig;
  /** Selected provider-local issue. */
  issueId: number;
  /** Exact slot run captured before PR preconditions. */
  worker: ActiveIssueWorker;
};

/** Successful finish response returned to tool adapters. */
export type FinishWorkResult = CompletionOutput & {
  /** Completion command finished successfully. */
  success: true;
  /** Human-readable project name. */
  project: string;
  /** Canonical project identity. */
  projectSlug: string;
  /** Completed issue. */
  issueId: number;
  /** Configured completing role. */
  role: string;
  /** Configured result. */
  result: string;
};

/** Rejection context retained without masking the original missing-worker error. */
export type MissingWorkerAuditInput = {
  /** Workspace receiving the audit record. */
  workspaceDir: string;
  /** Project display name. */
  projectName: string;
  /** Canonical project identity. */
  projectSlug: string;
  /** Requested role. */
  role: string;
  /** Requested result. */
  result: string;
  /** Requested caller session. */
  sessionKey?: string;
  /** Observed worker inventory. */
  roleWorker: RoleWorkerState;
  /** Resolved workflow interpreting local candidates. */
  workflow: WorkflowConfig;
};

/** Immutable context loaded before a worker slot is reserved. */
export type DispatchContext = {
  /** Provider comments actually considered for the message. */
  comments: IssueComment[];
  /** Current PR feedback included in the task. */
  prFeedback?: PrFeedback;
  /** Whether the message is specifically for conflict resolution. */
  isConflictFix: boolean;
  /** Rendered task sent to the worker. */
  taskMessage: string;
  /** Role instructions supplied as system context. */
  roleInstructions: string;
};
