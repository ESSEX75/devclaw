/**
 * application/setup/plugin-config.ts — Plugin config writer (openclaw.json).
 *
 * Handles: tool restrictions, subagent cleanup, heartbeat defaults.
 * Models are stored in workflow.yaml (not openclaw.json).
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { ExecutionMode } from "../../domain/index.js";
import { HEARTBEAT_DEFAULTS } from "../heartbeat/config.js";

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

const DEVCLAW_DENIED_TOOLS = ["sessions_spawn", "sessions_send"] as const;
const DEVCLAW_AGENT_TOOL_SET: ReadonlySet<string> = new Set(DEVCLAW_AGENT_TOOLS);

/**
 * Write DevClaw plugin config to openclaw.json plugins section.
 *
 * Configures:
 * - Tool permissions for DevClaw agents
 * - Subagent cleanup interval (30 days) to keep development sessions alive
 * - Heartbeat defaults
 *
 * Read-modify-write to preserve existing config.
 * Note: models are NOT stored here — they live in workflow.yaml.
 */
export async function writePluginConfig(
  runtime: PluginRuntime,
  agentId?: string,
  projectExecution?: ExecutionMode,
): Promise<void> {
  const config = structuredClone(runtime.config.current()) as unknown as OpenClawConfig;

  ensurePluginStructure(config);

  if (projectExecution && config.plugins?.entries?.devclaw?.config) {
    config.plugins.entries.devclaw.config.projectExecution = projectExecution;
  }

  // Remove plugin-local model config; models are owned by workflow.yaml.
  if (config.plugins?.entries?.devclaw?.config) {
    delete config.plugins.entries.devclaw.config.models;
  }

  ensurePluginAllowed(config);
  ensureInternalHooks(config);
  ensureHeartbeatDefaults(config);
  configureSubagentCleanup(config);
  ensureTelegramLinkPreviewDisabled(config);

  if (agentId) {
    configureDevClawAgentTools(config, agentId);
    allowActiveMemoryForAgent(config, agentId);
  }

  await runtime.config.replaceConfigFile({
    nextConfig: config,
    afterWrite: { mode: "auto" },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function ensurePluginStructure(config: OpenClawConfig): void {
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.entries.devclaw) config.plugins.entries.devclaw = {};
  if (!config.plugins.entries.devclaw.config) config.plugins.entries.devclaw.config = {};
}

/**
 * Ensure "devclaw" is in plugins.allow so OpenClaw trusts the plugin
 * without requiring manual config after install.
 */
function ensurePluginAllowed(config: OpenClawConfig): void {
  if (!config.plugins) config.plugins = {};
  if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
  if (!config.plugins.allow.includes("devclaw")) config.plugins.allow.push("devclaw");
}

function configureSubagentCleanup(config: OpenClawConfig): void {
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.subagents) config.agents.defaults.subagents = {};
  config.agents.defaults.subagents.archiveAfterMinutes = 43200;
}

function configureDevClawAgentTools(config: OpenClawConfig, agentId: string): void {
  for (const agent of config.agents?.list ?? []) {
    if (!agent.tools) agent.tools = {};

    if (agent.id !== agentId) {
      const currentDeny = Array.isArray(agent.tools.deny) ? agent.tools.deny : [];

      agent.tools.deny = [...new Set([...currentDeny, ...DEVCLAW_AGENT_TOOLS])];
      if (Array.isArray(agent.tools.alsoAllow)) {
        agent.tools.alsoAllow = agent.tools.alsoAllow.filter((tool) => !DEVCLAW_AGENT_TOOL_SET.has(tool));
      }

      if (Array.isArray(agent.tools.allow)) {
        agent.tools.allow = agent.tools.allow.filter((tool) => !DEVCLAW_AGENT_TOOL_SET.has(tool));
      }

      continue;
    }

    const currentAlsoAllow = Array.isArray(agent.tools.alsoAllow) ? agent.tools.alsoAllow : [];

    agent.tools.alsoAllow = [...new Set([...currentAlsoAllow, ...DEVCLAW_AGENT_TOOLS])];

    const currentDeny = Array.isArray(agent.tools.deny)
      ? agent.tools.deny.filter((tool) => !DEVCLAW_AGENT_TOOL_SET.has(tool))
      : [];

    agent.tools.deny = [...new Set([...currentDeny, ...DEVCLAW_DENIED_TOOLS])];

  }
}

function allowActiveMemoryForAgent(config: OpenClawConfig, agentId: string): void {
  const activeMemoryConfig = config.plugins?.entries?.["active-memory"]?.config as
    | { agents?: unknown }
    | undefined;

  if (!activeMemoryConfig) return;

  if (!Array.isArray(activeMemoryConfig.agents)) {
    activeMemoryConfig.agents = [agentId];

    return;
  }

  if (!activeMemoryConfig.agents.includes(agentId)) {
    activeMemoryConfig.agents.push(agentId);
  }
}

function ensureInternalHooks(config: OpenClawConfig): void {
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.internal) config.hooks.internal = {};
  config.hooks.internal.enabled = true;
}

function ensureHeartbeatDefaults(config: OpenClawConfig): void {
  const devclaw = config.plugins?.entries?.devclaw?.config;

  if (devclaw && !devclaw.work_heartbeat) {
    devclaw.work_heartbeat = { ...HEARTBEAT_DEFAULTS };
  }
}

/**
 * Disable Telegram link previews so notifications don't show URL preview cards.
 * Sets channels.telegram.linkPreview = false if the Telegram channel is configured.
 * Only sets if not already explicitly configured (respects user overrides).
 */
function ensureTelegramLinkPreviewDisabled(config: OpenClawConfig): void {
  const channels = config.channels;

  if (!channels) return;
  const telegram = channels.telegram;

  if (!telegram) return;
  if (telegram.linkPreview === undefined) {
    telegram.linkPreview = false;
  }
}
