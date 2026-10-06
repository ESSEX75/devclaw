/** Contracts owned by heartbeat service discovery, configuration, and timer lifecycle. */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../../context.js";
import type { AgentWorkspaceConfig } from "../../../integrations/openclaw/types.js";

/** One SDK-resolved agent/workspace pair whose projects belong to that agent. */
export type Agent = {
  /** Configured OpenClaw agent identity. */
  agentId: string;
  /** Canonical filesystem workspace after symlink normalization. */
  workspace: string;
};

/** Discovery result retains failures without suppressing healthy agents. */
export type AgentDiscoveryResult = {
  /** Unique agent/workspace pairs with at least one owned project. */
  agents: Agent[];
  /** Per-agent invalid or inaccessible workspace findings. */
  errors: string[];
};

/** Validated heartbeat schedule and pickup budget. */
export type HeartbeatConfig = {
  /** Whether periodic service ticks are enabled. */
  enabled: boolean;
  /** Interval between scheduled checks in seconds. */
  intervalSeconds: number;
  /** Maximum dispatches across all projects in one agent tick. */
  maxPickupsPerTick: number;
};

/** Narrow logger capability used for heartbeat lifecycle and agent diagnostics. */
export type HeartbeatServiceLogger = {
  /** Report lifecycle starts, stops, and completed maintenance. */
  info(message: string): void;
  /** Report recoverable discovery and agent failures. */
  warn(message: string): void;
  /** Report failures of the whole scheduled tick. */
  error(message: string): void;
};

/** Narrow registered service context consumed by heartbeat lifecycle. */
export type ServiceContext = {
  /** OpenClaw logger reporting only actionable lifecycle outcomes. */
  logger: HeartbeatServiceLogger;
  /** Fresh configured agent workspace inventory. */
  config: AgentWorkspaceConfig;
};

/** Service dependencies held across scheduled callbacks. */
export type HeartbeatServiceDependencies = {
  /** Fresh plugin options for each scheduled run. */
  pluginConfig?: Record<string, unknown>;
  /** SDK configuration fallback when no service snapshot exists. */
  config: AgentWorkspaceConfig;
  /** Gateway and provider command transport. */
  runCommand: RunCommand;
  /** Optional native runtime for exact notification delivery. */
  runtime?: PluginRuntime;
};

/** Stoppable service callbacks registered with OpenClaw. */
export type HeartbeatLifecycle = {
  /** Starts one timer generation. */
  start(context: ServiceContext): Promise<void>;
  /** Cancels timers and waits for the current generation to settle. */
  stop(context: ServiceContext): Promise<void>;
};
