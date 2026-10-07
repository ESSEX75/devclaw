/** Owns sessions contracts at the OpenClaw adapter boundary. */

import type { RunCommand } from "../../../context.js";
import type { AGENT_TURN_STATUS } from "./const.js";

/** One validated gateway observation; missing metrics never mean zero usage. */
export type GatewaySession = {
  /** Exact gateway session identity. */
  key: string;
  /** Last known activity time, or zero when not supplied. */
  updatedAt: number;
  /** Known context usage percentage; absent when metrics cannot establish it. */
  percentUsed?: number;
  /** Whether the last observed run aborted. */
  abortedLastRun?: boolean;
  /** Fresh token usage when supplied. */
  totalTokens?: number;
  /** Context window capacity when supplied. */
  contextTokens?: number;
};

/** Gateway evidence whose absence is authoritative only after all stores were read. */
export type SessionLookup = {
  /** Valid observations merged from stores and the bounded recent list. */
  sessions: Map<string, GatewaySession>;
  /** Every advertised store and record was read and validated successfully. */
  complete: boolean;
};

/** Gateway values needed to address and submit one worker turn. */
export type AgentTurnInput = {
  /** Immutable turn identity; a new feedback cycle must have a new token even when its session is reused. */
  submissionId: string;
  /** Optional agent owning the worker session. */
  agentId?: string;
  /** Optional parent session for traceability. */
  orchestratorSessionKey?: string;
  /** Maximum wait for the gateway command to finish. */
  dispatchTimeoutMs?: number;
  /** Role instructions added to the worker system prompt. */
  extraSystemPrompt?: string;
  /** Runtime command capability invoking the gateway CLI. */
  runCommand: RunCommand;
};

/** Clean gateway completion is acceptance evidence, independently of worker completion. */
type AcceptedAgentTurn = {
  /** Submission accepted by the gateway command. */
  kind: typeof AGENT_TURN_STATUS.ACCEPTED;
};

/** Local validation proves no gateway command was submitted. */
type RejectedAgentTurn = {
  /** Proven local rejection rather than a lost gateway response. */
  kind: typeof AGENT_TURN_STATUS.REJECTED;
  /** Local validation diagnostic. */
  reason: string;
};

/** A submitted command may have taken effect despite a missing or failed response. */
type UnknownAgentTurn = {
  /** Uncertain delivery requiring application-owned recovery. */
  kind: typeof AGENT_TURN_STATUS.UNKNOWN;
  /** Observed transport diagnostic, never evidence authorizing replay. */
  reason: string;
};

/** Observed result of one gateway submission; unknown never implies safe rollback. */
export type AgentTurnOutcome = AcceptedAgentTurn | RejectedAgentTurn | UnknownAgentTurn;
