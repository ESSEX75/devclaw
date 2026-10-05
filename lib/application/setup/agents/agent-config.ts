/**
 * application/setup/agents/agent-config.ts — Agent creation and workspace resolution.
 */

import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { findConfiguredAgent } from "../../../integrations/openclaw/agent-registry.js";
import { resolveConfiguredAgentWorkspace } from "../../../integrations/openclaw/agent-workspace.js";
import { CONFIG_RELOAD_MODE } from "../const.js";
import type { SetupRuntime } from "../types.js";
import { AGENT_DIRECTORY, AGENTS_DIRECTORY, MAIN_AGENT_ID, OPENCLAW_DIRECTORY, SESSIONS_DIRECTORY, WORKSPACE_DIRECTORY } from "./const.js";

/** Optional filesystem root used by isolated agent creation tests. */
type CreateAgentOptions = {
  /** OpenClaw home override, defaulting to the current user profile. */
  openClawHome?: string;
};

/**
 * Create an agent through a focused configuration mutation, then create its directories.
 * @param runtime - SDK configuration transport.
 * @param name - Agent display name normalized into its identifier.
 * @param options - Optional OpenClaw home override.
 */
export async function createAgent(
  runtime: SetupRuntime,
  name: string,
  options: CreateAgentOptions = {},
): Promise<{ agentId: string; workspacePath: string }> {
  const agentId = getAgentId(name);

  const openClawHome = options.openClawHome ?? path.join(homedir(), OPENCLAW_DIRECTORY);
  const defaultAgentWorkspace = getAgentWorkspacePath(agentId, openClawHome);
  const defaultAgentDir = path.join(openClawHome, AGENTS_DIRECTORY, agentId, AGENT_DIRECTORY);

  await runtime.config.mutateConfigFile({
    /** Create the agent only if it is still absent in the fresh configuration.
     * @param cfg - Writable SDK configuration draft.
     */
    mutate(cfg) {
      const existingAgent = findConfiguredAgent(cfg, agentId);

      if (existingAgent) {
        throw new Error(`Agent "${agentId}" already exists in openclaw.json.`);
      }

      cfg.agents ??= {};
      const defaultsModel = cfg.agents.defaults?.model;
      const model = typeof defaultsModel === "string" ? defaultsModel : defaultsModel?.primary;

      const entry = { name, workspace: defaultAgentWorkspace, agentDir: defaultAgentDir, ...(model ? { model } : {}) };

      if (cfg.agents.entries !== undefined) cfg.agents.entries[agentId] = entry;
      else {
        cfg.agents.list ??= [];
        cfg.agents.list.push({ id: agentId, ...entry });
      }
    },
    afterWrite: {
      mode: CONFIG_RELOAD_MODE.NONE,
      reason: "DevClaw setup continues with a second config write that owns reload handling.",
    },
  });

  await fs.mkdir(defaultAgentWorkspace, { recursive: true });
  await fs.mkdir(defaultAgentDir, { recursive: true });
  await fs.mkdir(path.join(openClawHome, AGENTS_DIRECTORY, agentId, SESSIONS_DIRECTORY), {
    recursive: true,
  });

  return { agentId, workspacePath: defaultAgentWorkspace };
}

/** Convert an agent display name to its stable OpenClaw identifier.
 * @param name - Requested display name; empty identifiers and main are rejected.
 */
export function getAgentId(name: string): string {
  const agentId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!agentId) throw new Error(`Invalid agent name: "${name}"`);
  if (agentId === MAIN_AGENT_ID) throw new Error('"main" is reserved. Choose another agent name.');

  return agentId;
}

/** Resolve the workspace path that would be assigned to a new agent.
 * @param agentId - Normalized agent identifier.
 * @param openClawHome - Configuration root, defaulting to the user profile.
 */
export function getAgentWorkspacePath(
  agentId: string,
  openClawHome = path.join(homedir(), OPENCLAW_DIRECTORY),
): string {
  return path.join(openClawHome, AGENTS_DIRECTORY, agentId, WORKSPACE_DIRECTORY);
}

/**
 * Resolve the effective SDK workspace, rejecting agents absent from the configuration.
 * @param runtime - Read-only configuration source.
 * @param agentId - Existing agent identifier.
 */
export async function resolveWorkspacePath(runtime: SetupRuntime, agentId: string): Promise<string> {
  const cfg = runtime.config.current();
  const agent = findConfiguredAgent(cfg, agentId);

  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in openclaw.json.`);
  }

  return resolveConfiguredAgentWorkspace(cfg, agentId);
}
