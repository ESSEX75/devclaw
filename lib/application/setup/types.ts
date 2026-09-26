/** Contracts for shared setup commands and read-only previews. */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import type { ExecutionMode, NOTIFICATION_CHANNEL, NotificationChannel } from "../../domain/index.js";

/** Model identifiers indexed by configured role and level. */
export type ModelConfig = Record<string, Record<string, string>>;

/** Supported notification transports for setup binding requests. */
export type SetupNotificationChannel = Extract<
  NotificationChannel,
  typeof NOTIFICATION_CHANNEL.TELEGRAM | typeof NOTIFICATION_CHANNEL.WHATSAPP
>;

/** Shared setup command inputs, independent of tool and terminal adapters. */
export type SetupOpts = {
  /** OpenClaw plugin runtime for config access. */
  runtime: SetupRuntime;
  /** Command transport used for the shared approval preflight. */
  runCommand: RunCommand;
  /** Create a new agent with this name. Mutually exclusive with agentId. */
  newAgentName?: string;
  /** Channel binding for the selected or newly-created agent. */
  channelBinding?: SetupNotificationChannel | null;
  /** Explicit account id required whenever a channel binding is requested. */
  channelAccountId?: string;
  /** Exact peer id required whenever a channel binding is requested. */
  channelPeerId?: string;
  /** Use an existing agent by ID. Mutually exclusive with newAgentName. */
  agentId?: string;
  /** Override workspace path (auto-detected from agent if not given). */
  workspacePath?: string;
  /** Model overrides per role.level. Unspecified assignments preserve resolved configuration. */
  models?: ModelConfig;
  /** Explicitly write packaged defaults into the workspace. Existing files are preserved. */
  ejectDefaults?: boolean;
  /** Explicitly replace packaged defaults with backups. */
  resetDefaults?: boolean;
  /** Explicitly refresh system instructions with backups. */
  refreshInstructions?: boolean;
  /** Plugin-level project execution mode: parallel or sequential. Default: parallel. */
  projectExecution?: ExecutionMode;
  /** Compute and validate the setup plan without writing configuration or workspace files. */
  dryRun?: boolean;
};

/** Outcome of a validated setup operation or preview. */
export type SetupResult = {
  /** Requested operation; file operations do not configure an agent. */
  operation: "configure" | "eject-defaults" | "reset-defaults" | "refresh-instructions";
  /** Scope preflight outcome; absent for preview and file-only operations. */
  scopePreflight?: ScopePreflightResult;
  /** Resolved agent identifier, or unknown for a workspace-only operation. */
  agentId: string;
  /** Whether the operation creates an agent (planned during preview). */
  agentCreated: boolean;
  /** Resolved filesystem workspace target. */
  workspacePath: string;
  /** Effective models after explicit overrides; empty for file-only operations. */
  models: ModelConfig;
  /** Workspace-relative paths actually written; empty during preview. */
  filesWritten: string[];
  /** Nonfatal operation diagnostics. */
  warnings: string[];
  /** Selected notification transport. */
  channelBinding?: SetupNotificationChannel | null;
  /** Exact channel account identifier. */
  channelAccountId?: string;
  /** Exact group or topic destination. */
  channelPeerId?: string;
  /** Whether create-only defaults were requested. */
  defaultsEjected?: boolean;
  /** True when no effects were applied. */
  dryRun: boolean;
  /** Human-readable validated operation plan. */
  plannedChanges: string[];
};


/** Runtime capabilities needed by setup; SDK-owned persistence supplies writable drafts. */
export type SetupRuntime = {
  /** Live read snapshot and focused config mutation transport. */
  config: {
    /** Obtain the current read-only configuration. */
    current: PluginRuntime["config"]["current"];
    /** Persist a focused mutation with the SDK's concurrency protection. */
    mutateConfigFile: (params: Parameters<PluginRuntime["config"]["mutateConfigFile"]>[0]) => Promise<unknown>;
  };
};
/** Read-only OpenClaw configuration surface required for route validation. */
export type RouteConfig = {
  readonly agents?: { readonly list?: readonly { readonly id: string }[] };
  readonly channels?: Readonly<Record<string, {
    readonly enabled?: boolean;
    readonly accounts?: Readonly<Record<string, unknown>>;
  }>>;
  readonly bindings?: readonly {
    readonly agentId: string;
    readonly match?: {
      readonly channel?: string;
      readonly accountId?: string;
      readonly peer?: { readonly id?: string };
    };
  }[];
};

/** One machine-readable route validation failure. */
export type RouteDiagnostic = {
  /** Stable code suitable for CLI and automation handling. */
  code: string;
  /** Human-readable explanation including the invalid route component. */
  message: string;
};

/** Validated fields returned by the OpenClaw approval CLI. */
export type ScopeCommandResult = {
  /** Whether the transport reports success. */
  ok?: boolean;
  /** Reported transport or preflight status. */
  status?: string;
  /** Permissions confirmed by the gateway. */
  approved?: string[];
  /** Permissions not yet granted. */
  missing?: string[];
  /** Approval request identifier when one exists. */
  requestId?: string;
  /** Transport-provided diagnostic text. */
  message?: string;
};

/** Nonblocking permission preflight outcome. */
export type ScopePreflightResult = {
  /** Reported transport or preflight status. */
  status: "approved" | "unavailable";
  /** Permissions confirmed by the gateway. */
  approved: string[];
  /** Permissions not yet granted. */
  missing: string[];
  /** Nonfatal transport availability diagnostic. */
  warning?: string;
};
