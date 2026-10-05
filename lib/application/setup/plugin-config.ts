/**
 * application/setup/plugin-config.ts — Plugin config writer (openclaw.json).
 *
 * Handles: tool restrictions, subagent cleanup, heartbeat defaults.
 * Models are stored in workflow.yaml (not openclaw.json).
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { ExecutionMode } from "../../domain/index.js";
import { findConfiguredAgent } from "../../integrations/openclaw/agent-registry.js";
import { HEARTBEAT_DEFAULTS } from "../heartbeat/service/defaults.js";
import { ACTIVE_MEMORY_PLUGIN_ID, CONFIG_RELOAD_MODE, DEVCLAW_PLUGIN_ID, SUBAGENT_ARCHIVE_AFTER_MINUTES } from "./const.js";
import { buildAgentToolPolicy, resolveProjectToolOwners } from "./permissions/index.js";
import type { SetupRuntime } from "./types.js";

/**
 * Write DevClaw plugin config to openclaw.json plugins section.
 *
 * Configures:
 * - Tool permissions for DevClaw agents
 * - Subagent cleanup interval (30 days) to keep development sessions alive
 * - Heartbeat defaults
 *
 * Uses SDK mutation to preserve concurrent configuration edits.
 * @param runtime - SDK configuration mutation transport.
 * @param agentId - Optional agent receiving DevClaw tool permissions.
 * @param projectExecution - Optional explicit scheduling-mode change.
 * Note: models are NOT stored here — they live in workflow.yaml.
 */
export async function writePluginConfig(
  runtime: SetupRuntime,
  agentId?: string,
  projectExecution?: ExecutionMode,
): Promise<void> {
  await runtime.config.mutateConfigFile({
    /** Apply policy using ownership read from the fresh mutation snapshot.
     * @param config - Writable SDK configuration under mutation protection.
     */
    async mutate(config) {
      if (agentId && !findConfiguredAgent(config, agentId)) throw new Error(`Agent "${agentId}" does not exist.`);
      const authorized = agentId ? new Set([agentId, ...await resolveProjectToolOwners(config)]) : undefined;

      ensurePluginStructure(config);

      if (projectExecution && config.plugins?.entries?.[DEVCLAW_PLUGIN_ID]?.config) {
        config.plugins.entries[DEVCLAW_PLUGIN_ID].config.projectExecution = projectExecution;
      }

      ensurePluginAllowed(config);
      ensureInternalHooks(config);
      ensureHeartbeatDefaults(config);
      configureSubagentCleanup(config);
      ensureTelegramLinkPreviewDisabled(config);

      if (agentId) {
        if (config.agents?.entries !== undefined) {
          for (const [id, agent] of Object.entries(config.agents.entries)) {
            agent.tools = buildAgentToolPolicy(agent.tools, authorized?.has(id) === true);
          }
        } else {
          for (const agent of config.agents?.list ?? []) {
            agent.tools = buildAgentToolPolicy(agent.tools, authorized?.has(agent.id) === true);
          }
        }

        allowActiveMemoryForAgent(config, agentId);
      }
    },
    afterWrite: { mode: CONFIG_RELOAD_MODE.AUTO },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Create the plugin configuration containers while preserving existing settings.
 * @param config - Fresh writable SDK configuration.
 */
function ensurePluginStructure(config: OpenClawConfig): void {
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.entries[DEVCLAW_PLUGIN_ID]) config.plugins.entries[DEVCLAW_PLUGIN_ID] = {};
  if (!config.plugins.entries[DEVCLAW_PLUGIN_ID].config) config.plugins.entries[DEVCLAW_PLUGIN_ID].config = {};
}

/**
 * Ensure "devclaw" is in plugins.allow so OpenClaw trusts the plugin
 * without requiring manual config after install.
 * @param config - Fresh writable SDK configuration.
 */
function ensurePluginAllowed(config: OpenClawConfig): void {
  if (!config.plugins) config.plugins = {};
  if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
  if (!config.plugins.allow.includes(DEVCLAW_PLUGIN_ID)) config.plugins.allow.push(DEVCLAW_PLUGIN_ID);
}

/** Retain managed worker sessions for the configured cleanup period.
 * @param config - Fresh writable SDK configuration.
 */
function configureSubagentCleanup(config: OpenClawConfig): void {
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.subagents) config.agents.defaults.subagents = {};
  config.agents.defaults.subagents.archiveAfterMinutes = SUBAGENT_ARCHIVE_AFTER_MINUTES;
}

/** Extend the optional memory plugin allowlist for the selected agent.
 * @param config - Fresh writable SDK configuration.
 * @param agentId - Explicitly selected setup agent.
 */
function allowActiveMemoryForAgent(config: OpenClawConfig, agentId: string): void {
  const activeMemoryConfig = config.plugins?.entries?.[ACTIVE_MEMORY_PLUGIN_ID]?.config;

  if (!activeMemoryConfig) return;

  if (!Array.isArray(activeMemoryConfig.agents)) {
    activeMemoryConfig.agents = [agentId];

    return;
  }

  if (!activeMemoryConfig.agents.includes(agentId)) {
    activeMemoryConfig.agents.push(agentId);
  }
}

/** Enable the internal hooks used by DevClaw.
 * @param config - Fresh writable SDK configuration.
 */
function ensureInternalHooks(config: OpenClawConfig): void {
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.internal) config.hooks.internal = {};
  config.hooks.internal.enabled = true;
}

/** Seed heartbeat defaults only when no explicit configuration exists.
 * @param config - Fresh writable SDK configuration.
 */
function ensureHeartbeatDefaults(config: OpenClawConfig): void {
  const devclaw = config.plugins?.entries?.[DEVCLAW_PLUGIN_ID]?.config;

  if (devclaw && !devclaw.work_heartbeat) {
    devclaw.work_heartbeat = { ...HEARTBEAT_DEFAULTS };
  }
}

/**
 * Disable Telegram link previews so notifications don't show URL preview cards.
 * Sets channels.telegram.linkPreview = false if the Telegram channel is configured.
 * Only sets if not already explicitly configured (respects user overrides).
 * @param config - Fresh writable SDK configuration.
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
