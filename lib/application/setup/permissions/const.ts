/** Stable setup identifiers owned by permissions. */

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

/** Stable justification attached to setup scope approval requests. */
export const SCOPE_APPROVAL_REASON = "devclaw-worker-dispatch";

/** Nonblocking scope preflight outcomes. */
export const SCOPE_PREFLIGHT_STATUS = {
  APPROVED: "approved",
  UNAVAILABLE: "unavailable",
} as const;
