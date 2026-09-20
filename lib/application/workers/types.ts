/**
 * Defines the application contracts for dispatching managed issues to worker sessions.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";

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
  runtime?: PluginRuntime;
  /** Concrete worker slot selected from the fresh queue snapshot. */
  slotIndex?: number;
  /** Optional DevClaw instance claiming the issue. */
  instanceName?: string;
  /** Command runner used for OpenClaw gateway operations. */
  runCommand: RunCommand;
};

/** Stable dispatch metadata returned to queue and tool callers. */
export type DispatchResult = {
  /** Whether dispatch created a session identity or reused an existing one. */
  sessionAction: "spawn" | "send";
  /** Deterministic OpenClaw worker session key. */
  sessionKey: string;
  /** Configured worker level selected for dispatch. */
  level: string;
  /** Resolved model assigned to the worker session. */
  model: string;
  /** Human-readable dispatch announcement. */
  announcement: string;
};
