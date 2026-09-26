/** Contracts for shared setup commands and read-only previews. */
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import type { ExecutionMode, NOTIFICATION_CHANNEL, NotificationChannel, NotificationEndpoint, Project } from "../../domain/index.js";
import type { SCOPE_STATUS } from "../../integrations/openclaw/scopes/index.js";
import type { ValueOf } from "../../types.js";
import type { ONBOARDING_MODE, ROUTE_DIAGNOSTIC_CODE, SCOPE_PREFLIGHT_STATUS, SETUP_OPERATION } from "./const.js";

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
  operation: ValueOf<typeof SETUP_OPERATION>;
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
/** Configured agent identity used by route inspection. */
type RouteAgent = {
  /** Stable configured identifier. */
  readonly id: string;
};
/** Channel availability and account inventory. */
type RouteChannel = {
  /** Explicit channel disablement takes precedence over account configuration. */
  readonly enabled?: boolean;
  /** Channel-specific settings remain unknown until inspected. */
  readonly accounts?: Readonly<Record<string, unknown>>;
};
/** Exact peer identity; absent or direct kinds do not establish a group route. */
type RoutePeer = {
  /** SDK peer kind. */
  readonly kind?: string;
  /** Group identifier, optionally qualified with a topic. */
  readonly id?: string;
};
/** Configured route matching fields. */
type RouteMatch = {
  /** Notification transport. */
  readonly channel?: string;
  /** Explicit configured account. */
  readonly accountId?: string;
  /** Exact peer restriction. */
  readonly peer?: RoutePeer;
};
/** Binding owner and destination. */
type RouteBinding = {
  /** Agent receiving matching messages. */
  readonly agentId: string;
  /** Fields restricting delivery to this binding. */
  readonly match?: RouteMatch;
};
/** Agent inventory available for route validation. */
type RouteAgentRoster = {
  /** Configured agent identities. */
  readonly list?: readonly RouteAgent[];
};

/** Read-only OpenClaw configuration surface required for route validation. */
export type RouteConfig = {
  /** Available route owners. */
  readonly agents?: RouteAgentRoster;
  /** Configured channel accounts. */
  readonly channels?: Readonly<Record<string, RouteChannel>>;
  /** Configured routing entries in SDK precedence order. */
  readonly bindings?: readonly RouteBinding[];
};

/** Project route inspection result without retaining the complete project state. */
export type ProjectRouteInspection = {
  /** Stable project identity and owner. */
  project: Pick<Project, "slug" | "name" | "agentId">;
  /** Inspected persisted destination. */
  endpoint: NotificationEndpoint;
  /** Reasons the exact route cannot be trusted. */
  diagnostics: RouteDiagnostic[];
};

/** One machine-readable route validation failure. */
export type RouteDiagnostic = {
  /** Stable code suitable for CLI and automation handling. */
  code: ValueOf<typeof ROUTE_DIAGNOSTIC_CODE>;
  /** Human-readable explanation including the invalid route component. */
  message: string;
};

/** Nonblocking permission preflight outcome. */
export type ScopePreflightResult = {
  /** Reported transport or preflight status. */
  status: ValueOf<typeof SCOPE_PREFLIGHT_STATUS>;
  /** Permissions confirmed by the gateway. */
  approved: string[];
  /** Permissions not yet granted. */
  missing: string[];
  /** Nonfatal transport availability diagnostic. */
  warning?: string;
};

/** SDK-owned per-agent tool policy, preserved when extending DevClaw permissions. */
export type AgentToolPolicy = NonNullable<NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number]["tools"]>;

/** Selected onboarding scenario. */
export type OnboardingMode = ValueOf<typeof ONBOARDING_MODE>;
/** Approval request details surfaced to setup adapters. */
export type ScopeApprovalRequiredDetails = {
  /** Gateway approval request identifier. */
  requestId: string;
  /** Complete permissions required by DevClaw. */
  requiredScopes: string[];
  /** Permissions awaiting approval. */
  missingScopes: string[];
};
/** Explicit refusal or expiration of an approval request. */
export type ScopeApprovalRejectedDetails = {
  /** Nonrecoverable outcome for this request. */
  status: typeof SCOPE_STATUS.DENIED | typeof SCOPE_STATUS.EXPIRED;
  /** Gateway request identifier when supplied. */
  requestId?: string;
};
