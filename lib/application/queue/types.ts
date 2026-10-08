/** Public queue tick options and action summaries. */

import type { RunCommand } from "../../context.js";
import type { IssueRuntimeState, RoleWorkerState, STATE_TYPE, WorkflowConfig, WorkflowStateConfig } from "../../domain/index.js";
import type { Issue, IssueProvider, ProviderIssueLookupErrorCode } from "../../integrations/providers/index.js";
import type { ResolvedRoleConfig } from "../../state/index.js";
import type { ValueOf } from "../../types.js";
import type { NotificationRuntime } from "../notifications/index.js";
import type { DispatchResult } from "../workers/index.js";
import type { QUEUE_PLAN, QUEUE_REASON } from "./const.js";

/** Display metadata retained for a non-terminal workflow state. */
type QueueStateLabel = {
  /** Provider-visible state label. */
  label: string;
  /** Worker role attached to active or queue states. */
  role?: string;
  /** Scheduling priority attached to queue states. */
  priority?: number;
};

/** Workflow labels grouped by non-terminal state behavior. */
export type QueueStateLabelsByType = Record<
  Exclude<WorkflowStateConfig["type"], typeof STATE_TYPE.TERMINAL>,
  QueueStateLabel[]
>;

/** Pure inputs for choosing the role level and concrete free slot. */
export type QueuePickupPlanInput = {
  /** Provider issue content used for existing complexity classification. */
  issue: Issue;
  /** Authoritative local runtime state for policy and role selection. */
  localState: IssueRuntimeState;
  /** Configured role being filled by the tick. */
  role: string;
  /** Resolved custom or built-in role levels. */
  roleConfig: ResolvedRoleConfig;
  /** Fresh project slot snapshot for the selected role. */
  worker: RoleWorkerState;
};

/** Pure pickup decision consumed by the queue coordinator. */
export type QueuePickupDecision = QueueBlockedPlan | QueueReadyPlan;

/** A constraint preventing the selected candidate from taking a slot. */
type QueueBlockedPlan = {
  /** Unsuccessful planning discriminator. */
  kind: typeof QUEUE_PLAN.BLOCKED;
  /** Stable queue-owned constraint code. */
  code: ValueOf<typeof QUEUE_REASON>;
  /** Operator-readable explanation. */
  reason: string;
};

/** Concrete worker assignment still requiring atomic reservation. */
type QueueReadyPlan = {
  /** Successful planning discriminator. */
  kind: typeof QUEUE_PLAN.READY;
  /** Configured role level. */
  level: string;
  /** Free position in the level's slots. */
  slotIndex: number;
  /** Expected session reuse or creation. */
  sessionAction: DispatchResult["sessionAction"];
};

/** Canonical location of one project's authoritative queue. */
export type QueueStateLocation = {
  /** Workspace containing local stores. */
  workspaceDir: string;
  /** Canonical project identifier. */
  projectSlug: string;
};

/** Provider content paired with local routing authority. */
export type QueueCandidate = {
  /** Provider issue content, never the routing source. */
  issue: Issue;
  /** Locally authoritative queue label. */
  label: string;
  /** Policy, assignment, and ownership snapshot. */
  localState: IssueRuntimeState;
};

/** Result of rechecking and dispatching a candidate under its issue lock. */
export type QueueClaim = {
  /** Planned or dispatched pickup, absent when a prerequisite changed. */
  action: TickAction | null;
  /** Explanation when no pickup is made. */
  reason?: string;
  /** Optional machine-readable prerequisite code. */
  code?: ValueOf<typeof QUEUE_REASON>;
};

/** One role that could not be processed during a tick. */
type QueueSkip = {
  /** Configured role, absent for project-wide failures. */
  role?: string;
  /** Operator-readable context. */
  reason: string;
  /** Queue constraint or unchanged provider lookup classification. */
  code?: ValueOf<typeof QUEUE_REASON> | ProviderIssueLookupErrorCode;
};

/** One issue picked up and dispatched during a project tick. */
export type TickAction = {
  /** Human-readable project name. */
  project: string;
  /** Canonical project identifier. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider issue title. */
  issueTitle: string;
  /** Link to the provider issue. */
  issueUrl: string;
  /** Configured worker role selected by the queue. */
  role: string;
  /** Configured level selected from local state and policy. */
  level: string;
  /** Session action planned or performed by dispatch. */
  sessionAction: DispatchResult["sessionAction"];
  /** Human-readable pickup summary. */
  announcement: string;
};

/** Pickups and safely skipped roles from one queue tick. */
export type ProjectTickResult = {
  /** Successfully planned or dispatched issue pickups. */
  pickups: TickAction[];
  /** Roles that could not be dispatched with an explanation. */
  skipped: QueueSkip[];
};

/** Dependencies and bounds for one project queue tick. */
export type ProjectTickOptions = {
  /** Workspace containing authoritative project and issue state. */
  workspaceDir: string;
  /** Canonical project to scan. */
  projectSlug: string;
  /** Optional session agent identity for dispatch. */
  agentId?: string;
  /** Optional parent session recorded with worker turns. */
  sessionKey?: string;
  /** Optional plugin settings for notifications. */
  pluginConfig?: Record<string, unknown>;
  /** Plan pickups without state or provider mutation. */
  dryRun?: boolean;
  /** Maximum number of pickups in this tick. */
  maxPickups?: number;
  /** Optional role restriction used by completion orchestration. */
  targetRole?: string;
  /** Injected provider for tests or existing caller context. */
  provider?: IssueProvider;
  /** Runtime used for exact notification delivery. */
  runtime?: NotificationRuntime;
  /** Optional resolved workflow override. */
  workflow?: WorkflowConfig;
  /** Instance identity used for local issue ownership. */
  instanceName?: string;
  /** Command capability required when dispatching. */
  runCommand?: RunCommand;
};
