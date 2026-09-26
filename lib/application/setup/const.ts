/** Supported setup channel identifiers. */
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";

/** Channels supported by the setup adapter. */
export const SETUP_NOTIFICATION_CHANNELS = [NOTIFICATION_CHANNEL.TELEGRAM, NOTIFICATION_CHANNEL.WHATSAPP] as const;
/** Stable diagnostic codes produced by strict route validation. */
export const ROUTE_DIAGNOSTIC_CODE = {
  AGENT_NOT_FOUND: "route.agent_not_found",
  CHANNEL_NOT_FOUND: "route.channel_not_found",
  CHANNEL_DISABLED: "route.channel_disabled",
  ACCOUNT_NOT_FOUND: "route.account_not_found",
  BINDING_NOT_FOUND: "route.binding_not_found",
  BINDING_AGENT_MISMATCH: "route.binding_agent_mismatch",
  DESTINATION_CONFLICT: "route.destination_conflict",
} as const;

/** Gateway permissions required before setup configuration changes. */
export const REQUIRED_OPENCLAW_SCOPES = [
  "operator.read",
  "operator.write",
] as const;

/** Supported tools explicitly isolated to DevClaw agents. */
export const DEVCLAW_AGENT_TOOLS = [
  "task_start",
  "work_finish",
  "task_create",
  "task_set_level",
  "task_comment",
  "task_edit_body",
  "task_attach",
  "task_owner",
  "tasks_status",
  "task_list",
  "project_status",
  "health",
  "project_register",
  "sync_labels",
  "channel_link",
  "channel_unlink",
  "channel_list",
  "setup",
  "onboard",
  "autoconfigure_models",
  "research_task",
  "workflow_guide",
  "config",
  "issue_repair",
  "issue_policy_migrate",
  "issue_delete",
] as const;

/** Session tools that bypass managed worker orchestration. */
export const DEVCLAW_DENIED_TOOLS = ["sessions_spawn", "sessions_send"] as const;
/** Membership set used to preserve unrelated tool permissions. */
export const DEVCLAW_AGENT_TOOL_SET: ReadonlySet<string> = new Set(DEVCLAW_AGENT_TOOLS);


/** OpenClaw configuration root below the user home. */
export const OPENCLAW_DIRECTORY = ".openclaw";
/** Directory holding named OpenClaw agents. */
export const AGENTS_DIRECTORY = "agents";
/** Agent-local runtime configuration directory. */
export const AGENT_DIRECTORY = "agent";
/** Default agent workspace directory. */
export const WORKSPACE_DIRECTORY = "workspace";
/** Agent session persistence directory. */
export const SESSIONS_DIRECTORY = "sessions";
