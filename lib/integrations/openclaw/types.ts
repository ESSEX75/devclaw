/** Contracts for submitting a worker turn through the OpenClaw gateway. */
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
