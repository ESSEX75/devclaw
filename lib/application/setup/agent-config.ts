/**
 * application/setup/agent-config.ts — Agent creation and workspace resolution.
 */
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";

type AgentConfig = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

type CreateAgentOptions = {
  openClawHome?: string;
};

/**
 * Create a new agent config entry and workspace.
 */
export async function createAgent(
  api: OpenClawPluginApi | PluginRuntime,
  name: string,
  options: CreateAgentOptions = {},
): Promise<{ agentId: string; workspacePath: string }> {
  const agentId = getAgentId(name);

  const openClawHome = options.openClawHome ?? path.join(homedir(), ".openclaw");
  const defaultAgentWorkspace = getAgentWorkspacePath(agentId, openClawHome);
  const defaultAgentDir = path.join(openClawHome, "agents", agentId, "agent");
  const runtime = "runtime" in api ? api.runtime : api;

  const cfg = structuredClone(runtime.config.current()) as unknown as OpenClawConfig;
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
  } as AgentConfig);

  await runtime.config.replaceConfigFile({
    nextConfig: cfg,
    afterWrite: {
      mode: "none",
      reason: "DevClaw setup continues with a second config write that owns reload handling.",
    },
  });

  await fs.mkdir(defaultAgentWorkspace, { recursive: true });
  await fs.mkdir(defaultAgentDir, { recursive: true });
  await fs.mkdir(path.join(openClawHome, "agents", agentId, "sessions"), {
    recursive: true,
  });

  await cleanupWorkspace(defaultAgentWorkspace);

  return { agentId, workspacePath: defaultAgentWorkspace };
}

/** Convert an agent display name to its stable OpenClaw identifier. */
export function getAgentId(name: string): string {
  const agentId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!agentId) throw new Error(`Invalid agent name: "${name}"`);
  if (agentId === "main") throw new Error('"main" is reserved. Choose another agent name.');

  return agentId;
}

/** Resolve the workspace path that would be assigned to a new agent. */
export function getAgentWorkspacePath(
  agentId: string,
  openClawHome = path.join(homedir(), ".openclaw"),
): string {
  return path.join(openClawHome, "agents", agentId, "workspace");
}

/**
 * Resolve workspace path from an agent ID via OpenClaw config API.
 */
export function resolveWorkspacePath(api: OpenClawPluginApi | PluginRuntime, agentId: string): string {
  const runtime = "runtime" in api ? api.runtime : api;
  const cfg = runtime.config.current();
  const agent = cfg.agents?.list?.find((a) => a.id === agentId);

  if (!agent?.workspace) {
    throw new Error(`Agent "${agentId}" not found in openclaw.json or has no workspace configured.`);
  }

  return agent.workspace;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function cleanupWorkspace(workspacePath: string): Promise<void> {
  // New agent workspaces should start clean even if a template copied these.
  try { await fs.rm(path.join(workspacePath, ".git"), { recursive: true }); } catch { /* may not exist */ }

  try { await fs.unlink(path.join(workspacePath, "BOOTSTRAP.md")); } catch { /* may not exist */ }
}
