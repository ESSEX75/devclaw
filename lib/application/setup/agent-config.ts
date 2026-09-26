/**
 * application/setup/agent-config.ts — Agent creation and workspace resolution.
 */
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { AGENT_DIRECTORY, AGENTS_DIRECTORY, OPENCLAW_DIRECTORY, SESSIONS_DIRECTORY, WORKSPACE_DIRECTORY } from "./const.js";
import type { SetupRuntime } from "./types.js";

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
    mutate(cfg) {
      const existingAgent = cfg.agents?.list?.find((agent) => agent.id === agentId);

      if (existingAgent) {
        throw new Error(`Agent "${agentId}" already exists in openclaw.json.`);
      }

      cfg.agents ??= {};
      cfg.agents.list ??= [];
      const defaultsModel = cfg.agents.defaults?.model;
      const model = typeof defaultsModel === "string" ? defaultsModel : defaultsModel?.primary;

      cfg.agents.list.push({
        id: agentId,
        name,
        workspace: defaultAgentWorkspace,
        agentDir: defaultAgentDir,
        ...(model ? { model } : {}),
      });
    },
    afterWrite: {
      mode: "none",
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
  if (agentId === "main") throw new Error('"main" is reserved. Choose another agent name.');

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
 * Resolve the configured workspace, rejecting absent agents or workspaces.
 * @param runtime - Read-only configuration source.
 * @param agentId - Existing agent identifier.
 */
export function resolveWorkspacePath(runtime: SetupRuntime, agentId: string): string {
  const cfg = runtime.config.current();
  const agent = cfg.agents?.list?.find((a) => a.id === agentId);

  if (!agent?.workspace) {
    throw new Error(`Agent "${agentId}" not found in openclaw.json or has no workspace configured.`);
  }

  return agent.workspace;
}
