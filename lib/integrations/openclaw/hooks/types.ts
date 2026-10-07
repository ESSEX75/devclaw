/** Owns hooks contracts at the OpenClaw adapter boundary. */

import type { toPluginMessageContext, toPluginMessageReceivedEvent } from "openclaw/plugin-sdk/hook-runtime";

import type { PluginContext,RunCommand } from "../../../context.js";
import type { ATTACHMENT_MESSAGE_HOOK } from "./const.js";

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
  event: AttachmentMessageEvent,
  context: AttachmentMessageContext,
) => Promise<void>;

/** Incoming message already normalized by the installed SDK hook runtime. */
export type AttachmentMessageEvent = ReturnType<typeof toPluginMessageReceivedEvent>;

/** SDK routing context retaining explicit owner, account and conversation identities. */
export type AttachmentMessageContext = ReturnType<typeof toPluginMessageContext>;

/** Exact incoming SDK route passed to application-owned project resolution. */
export type AttachmentMessageRoute = {
  /** SDK channel identifier; never inferred from attachment metadata. */
  channel: string;
  /** Explicit account supplied by the SDK, without a guessed default. */
  accountId: string;
  /** Conversation identity without the canonical topic qualifier. */
  conversationId: string;
  /** Exact thread identity agreed by the conversation qualifier and message event. */
  threadId?: string;
  /** Owner parsed only from an explicitly scoped canonical SDK session. */
  agentId: string;
};

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
