/**
 * setup/config.ts — Plugin config writer (openclaw.json).
 *
 * Handles: tool restrictions, subagent cleanup, heartbeat defaults.
 * Models are stored in workflow.yaml (not openclaw.json).
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { HEARTBEAT_DEFAULTS } from "../services/heartbeat/index.js";
import type { ExecutionMode } from "../workflow/index.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

/**
 * Write DevClaw plugin config to openclaw.json plugins section.
 *
 * Configures:
 * - Tool restrictions (deny sessions_spawn, sessions_send) for DevClaw agents
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

  // Clean up legacy models from openclaw.json (moved to workflow.yaml)
  if (config.plugins?.entries?.devclaw?.config) {
    delete config.plugins.entries.devclaw.config.models;
  }

  ensurePluginAllowed(config);
  ensureInternalHooks(config);
  ensureHeartbeatDefaults(config);
  configureSubagentCleanup(config);
  ensureTelegramLinkPreviewDisabled(config);

  if (agentId) {
    addToolRestrictions(config, agentId);
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

function addToolRestrictions(config: OpenClawConfig, agentId: string): void {
  const agent = config.agents?.list?.find((a) => a.id === agentId);
  if (agent) {
    if (!agent.tools) agent.tools = {};
    agent.tools.deny = ["sessions_spawn", "sessions_send"];
    delete agent.tools.allow;
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
