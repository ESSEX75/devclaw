/** Contracts for OpenClaw workspace resolution and gateway worker-turn submission. */

import type { toPluginMessageContext, toPluginMessageReceivedEvent } from "openclaw/plugin-sdk/hook-runtime";

import type { RunCommand } from "../../context.js";
import type { PluginContext } from "../../context.js";
import type { ATTACHMENT_MESSAGE_HOOK } from "./attachment-const.js";
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

/** Mutable instruction resource owned by the SDK bootstrap event. */
export type WorkerBootstrapFile = {
  /** SDK resource basename. */
  name: string;
  /** SDK resource location. */
  path: string;
  /** Instruction contents, absent for missing files. */
  content?: string;
  /** Whether the SDK should omit this resource. */
  missing: boolean;
};

/** Validated SDK bootstrap context; file objects remain SDK-owned and mutable. */
export type WorkerBootstrapContext = {
  /** Resolved workspace used to inspect instruction ownership. */
  workspaceDir: string;
  /** Original SDK resources to replace in place. */
  bootstrapFiles: WorkerBootstrapFile[];
};

/** SDK media callback with the concrete received-message contract. */
type AttachmentMessageHandler = (
  event: ReturnType<typeof toPluginMessageReceivedEvent>,
  context: ReturnType<typeof toPluginMessageContext>,
) => Promise<void>;

/** Only the message registration capability required by attachment capture. */
export type AttachmentHookRegistrar = {
  /** Register received-media handling without requiring unrelated plugin APIs.
   * @param name - SDK received-message hook identifier.
   * @param handler - Callback using the current SDK event and routing contracts.
   */
  on(name: typeof ATTACHMENT_MESSAGE_HOOK, handler: AttachmentMessageHandler): void;
};

/** Runtime dependencies used by the media hook, excluding mutation of SDK configuration. */
export type AttachmentHookContext = {
  /** Provider command transport. */
  runCommand: RunCommand;
  /** Diagnostics for rejected routing or failed attachment capture. */
  logger: Pick<PluginContext["logger"], "warn">;
  /** Read-only live configuration capability. */
  runtime: AttachmentHookRuntime;
};

/** Live SDK configuration reader used during owner workspace discovery. */
type AttachmentHookRuntime = {
  /** Current effective configuration, refreshed per incoming message. */
  config: Pick<PluginContext["runtime"]["config"], "current">;
};

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
  | { kind: typeof AGENT_TURN_STATUS.ACCEPTED }
  | { kind: typeof AGENT_TURN_STATUS.REJECTED; reason: string }
  | { kind: typeof AGENT_TURN_STATUS.UNKNOWN; reason: string };

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
  readonly entries?: Readonly<Record<string, Omit<AgentWorkspaceEntry, "id">>>;
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

/** Local media staged by the SDK or selected explicitly by the user. */
export type MediaAttachmentInfo = {
  /** Source path authorized by the caller. */
  localPath: string;
  /** Known media type, otherwise detected through the SDK. */
  mimeType?: string;
  /** Display filename, otherwise taken from the source basename. */
  filename?: string;
};
