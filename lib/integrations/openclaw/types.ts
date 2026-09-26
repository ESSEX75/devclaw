/** Contracts for OpenClaw workspace resolution and gateway worker-turn submission. */
import type { RunCommand } from "../../context.js";

/** Gateway values needed to address and submit one worker turn. */
export type AgentTurnInput = {
  /** Optional agent owning the worker session. */
  agentId?: string;
  /** Human-readable project name included in the idempotency key. */
  projectName: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Configured role assigned to the turn. */
  role: string;
  /** Configured level assigned to the turn. */
  level?: string;
  /** Concrete worker slot containing the turn. */
  slotIndex?: number;
  /** Workflow label consumed by dispatch. */
  fromLabel?: string;
  /** Optional parent session for traceability. */
  orchestratorSessionKey?: string;
  /** Workspace receiving transport audit warnings. */
  workspaceDir: string;
  /** Maximum wait for the gateway command to finish. */
  dispatchTimeoutMs?: number;
  /** Role instructions added to the worker system prompt. */
  extraSystemPrompt?: string;
  /** Runtime command capability invoking the gateway CLI. */
  runCommand: RunCommand;
};

/** Observed result of the gateway command; unknown never implies safe rollback. */
export type AgentTurnOutcome =
  | { kind: "accepted" }
  | { kind: "rejected"; reason: string }
  | { kind: "unknown"; reason: string };

/** Read-only SDK workspace inputs; unrelated configuration never crosses this boundary. */
export type AgentWorkspaceConfig = {
  /** Agent inventory and workspace defaults. */
  readonly agents?: AgentWorkspaceInventory;
};
/** Workspace settings understood by SDK agent resolution. */
type AgentWorkspaceInventory = {
  /** Default workspace root when no per-agent override exists. */
  readonly defaults?: { /** Filesystem workspace root. */ readonly workspace?: string };
  /** Configured agent identifiers and workspace overrides. */
  readonly list?: readonly AgentWorkspaceEntry[];
};
/** One configured agent's workspace identity. */
type AgentWorkspaceEntry = {
  /** Stable configured agent identifier. */
  readonly id: string;
  /** Explicit workspace override. */
  readonly workspace?: string;
  /** SDK default-agent marker relevant to workspace inheritance. */
  readonly default?: boolean;
};
