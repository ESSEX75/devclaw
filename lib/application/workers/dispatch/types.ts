/** Contracts owned by worker dispatch. */

import type { RunCommand } from "../../../context.js";
import type { Project, SlotState, WorkflowConfig } from "../../../domain/index.js";
import { WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import type { AGENT_TURN_STATUS } from "../../../integrations/openclaw/const.js";
import type { AgentTurnOutcome } from "../../../integrations/openclaw/types.js";
import type { IssueComment, IssueProvider } from "../../../integrations/providers/provider.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import type { ValueOf } from "../../../types.js";
import type { NotificationRuntime } from "../../notifications/index.js";
import type { PrFeedback } from "../../review/index.js";
import type { TaskContextBudget } from "../../tasks/index.js";
import type { WORKER_SESSION_ACTION } from "../const.js";

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
  resolvedRole: ResolvedRoleConfig;
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
  /** Optional task input estimate policy; independent of session-reset thresholds. */
  taskContextBudget?: TaskContextBudget;
  /** Resolved scheduling constraint supplied by a queue workflow override. */
  roleExecution?: WorkflowConfig["roleExecution"];
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

/** Gateway submission still running after the brief observation window. */
type PendingSessionDelivery = {
  /** Pending evidence retains the worker reservation until an outcome is known. */
  kind: typeof WORKER_DELIVERY_STATUS.PENDING;
};

/** Immediate observation and eventual settlement of one gateway submission. */
export type SessionDeliveryObservation = {
  /** Outcome seen within the brief acceptance window. */
  initial: AgentTurnOutcome | PendingSessionDelivery;
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

/** Immutable context loaded before a worker slot is reserved. */
export type DispatchContext = {
  /** Original provider comments included in full and eligible for acknowledgement. */
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
