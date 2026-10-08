/** Owns hooks contracts at the OpenClaw adapter boundary. */

import type { toPluginMessageContext, toPluginMessageReceivedEvent } from "openclaw/plugin-sdk/hook-runtime";

import type { PluginContext, RunCommand } from "../../../context.js";
import type { Project } from "../../../domain/index.js";
import type { IssueProvider } from "../../providers/index.js";
import type { MediaAttachmentInfo } from "../media/index.js";
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

/** Minimum confirmed identity needed by the SDK instruction adapter for diagnostics. */
export type BootstrapInstructionIdentity = {
  /** Application-validated role, including configured custom roles. */
  role: string;
  /** Persisted project owning the exact worker session. */
  projectSlug: string;
};

/** Application-selected instructions whose source is retained for diagnostics. */
type BootstrapInstructionContent = {
  /** Role prompt content; an empty prompt keeps the orchestrator resource stripped. */
  content: string;
  /** Confirmed source description reported by the loader. */
  source: string | null;
};

/** Injected ownership resolution and prompt loading, preserving the complete application identity type. */
export type BootstrapHookActions<TIdentity extends BootstrapInstructionIdentity> = {
  /** Resolve only an exact persisted worker; null leaves SDK instructions untouched.
   * @param workspaceDir - SDK-resolved workspace containing local ownership state.
   * @param sessionKey - Exact incoming SDK worker session identity.
   */
  resolveWorkerBootstrapIdentity(workspaceDir: string, sessionKey: string): Promise<TIdentity | null>;
  /** Load role instructions after the SDK adapter clears the orchestrator resource.
   * @param workspaceDir - Workspace used for the confirmed ownership resolution.
   * @param identity - Complete identity returned by that resolution.
   */
  loadWorkerBootstrapInstructions(workspaceDir: string, identity: TIdentity): Promise<BootstrapInstructionContent>;
};

/** SDK-resolved workspace for one explicitly configured owner. */
type AttachmentOwnerWorkspace = {
  /** Explicit SDK agent identity. */
  agentId: string;
  /** Effective SDK workspace for that identity. */
  workspaceDir: string;
};

/** Application-confirmed project selected from a complete incoming route. */
type AttachmentHookProject = {
  /** Registry workspace owning the confirmed project. */
  workspaceDir: string;
  /** Registered domain project; no provider observation selects this destination. */
  project: Project;
};

/** Resolved attachment capture handed to the application-owned persistence flow. */
type AttachmentCaptureInput = {
  /** Registry workspace owning local attachment storage. */
  workspaceDir: string;
  /** Confirmed project destination. */
  projectSlug: string;
  /** Explicit issue reference from the incoming message. */
  issueId: number;
  /** Confirmed project provider capabilities. */
  provider: IssueProvider;
  /** Sender supplied by the SDK event. */
  uploader: string;
  /** Complete ordered media observations from the SDK boundary. */
  mediaAttachments: MediaAttachmentInfo[];
};

/** Provider capability selected by the injected project resolver. */
type AttachmentHookProvider = {
  /** Resolved provider retained for all captured issue references. */
  provider: IssueProvider;
};

/** Injected application decisions; SDK registration and route normalization remain adapter-owned. */
export type AttachmentHookActions = {
  /** Extract explicit issue references without deciding workflow state.
   * @param text - Complete incoming message content.
   */
  extractIssueReferences(text: string): number[];
  /** Resolve an unambiguous registered project using all observed owner workspaces.
   * @param workspaces - Effective workspaces of eligible explicitly scoped owners.
   * @param route - Complete normalized SDK route.
   */
  resolveAttachmentProject(workspaces: readonly AttachmentOwnerWorkspace[], route: AttachmentMessageRoute): Promise<AttachmentHookProject | null>;
  /** Select the provider persisted for the confirmed project.
   * @param workspaceDir - Workspace owning that project registry.
   * @param project - Confirmed registered destination.
   * @param runCommand - Plugin-owned provider command capability.
   */
  resolveProvider(workspaceDir: string, project: Project, runCommand: RunCommand): Promise<AttachmentHookProvider>;
  /** Persist incoming bytes and project confirmed URLs; the hook does not consume the returned metadata.
   * @param input - Confirmed destination and complete staged media.
   */
  processAttachmentMessage(input: AttachmentCaptureInput): Promise<unknown>;
};
