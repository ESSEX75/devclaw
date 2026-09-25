/** Public queue tick options and action summaries. */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import type { IssueRuntimeState, RoleWorkerState, WorkflowConfig } from "../../domain/index.js";
import type { Issue, IssueProvider } from "../../integrations/providers/index.js";
import type { ResolvedRoleConfig } from "../../state/index.js";

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
export type QueuePickupDecision =
  | { kind: "blocked"; reason: string }
  | { kind: "ready"; level: string; slotIndex: number; sessionAction: "spawn" | "send" };

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
  sessionAction: "spawn" | "send";
  /** Human-readable pickup summary. */
  announcement: string;
};

/** Pickups and safely skipped roles from one queue tick. */
export type ProjectTickResult = {
  /** Successfully planned or dispatched issue pickups. */
  pickups: TickAction[];
  /** Roles that could not be dispatched with an explanation. */
  skipped: Array<{ role?: string; reason: string }>;
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
  runtime?: PluginRuntime;
  /** Optional resolved workflow override. */
  workflow?: WorkflowConfig;
  /** Instance identity used for local issue ownership. */
  instanceName?: string;
  /** Command capability required when dispatching. */
  runCommand?: RunCommand;
};
