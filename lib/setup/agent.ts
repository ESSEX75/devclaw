/**
 * setup/agent.ts — Agent creation and workspace resolution.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";
import type { RunCommand } from "../context.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

/**
 * Create a new agent via `openclaw agents add`.
 * Cleans up .git and BOOTSTRAP.md from the workspace, updates display name.
 */
export async function createAgent(
  api: OpenClawPluginApi | PluginRuntime,
  name: string,
  runCommand: RunCommand,
  channelBinding?: "telegram" | "whatsapp" | null,
): Promise<{ agentId: string; workspacePath: string }> {
  const rc = runCommand;
  const agentId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const defaultAgentWorkspace = path.join(homedir(), ".openclaw", "agents", agentId, "workspace");

  const args = [
    "agents",
    "add",
    agentId,
    "--non-interactive",
    "--workspace",
    defaultAgentWorkspace,
  ];
  if (channelBinding) args.push("--bind", channelBinding);

  try {
    const result = await rc(["openclaw", ...args], { timeoutMs: 30_000 });
    if (result.code != null && result.code !== 0) {
      throw new Error(result.stderr?.trim() || `Command failed with exit code ${result.code}`);
    }
  } catch (err) {
    throw new Error(`Failed to create agent "${name}": ${(err as Error).message}`);
  }

  const runtime = "runtime" in api ? api.runtime : api;
  // Wait for the workspace entry to become visible after the async agent creation.
  const workspacePath = await waitForAgentWorkspace(runtime, agentId, 30_000);
  await cleanupWorkspace(workspacePath);
  await updateAgentDisplayName(runtime, agentId, name);

  return { agentId, workspacePath };
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

/**
 * Poll resolveWorkspacePath until the agent workspace appears in the config.
 *
 * After `openclaw agents add` the config file may not be updated immediately,
 * so we retry every 500 ms until the deadline is reached.
 */
async function waitForAgentWorkspace(
  runtime: PluginRuntime,
  agentId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return resolveWorkspacePath(runtime, agentId);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `Agent "${agentId}" was created but workspace was not found in openclaw.json within ${timeoutMs}ms.`,
  );
}

async function cleanupWorkspace(workspacePath: string): Promise<void> {
  // openclaw agents add creates a .git dir and BOOTSTRAP.md — remove them
  try { await fs.rm(path.join(workspacePath, ".git"), { recursive: true }); } catch { /* may not exist */ }
  try { await fs.unlink(path.join(workspacePath, "BOOTSTRAP.md")); } catch { /* may not exist */ }
}

async function updateAgentDisplayName(runtime: PluginRuntime, agentId: string, name: string): Promise<void> {
  if (name === agentId) return;
  try {
    const cfg = structuredClone(runtime.config.current()) as unknown as OpenClawConfig;
    const agent = cfg.agents?.list?.find((a) => a.id === agentId);
    if (agent) {
      agent.name = name;
      await runtime.config.replaceConfigFile({
        nextConfig: cfg,
        afterWrite: { mode: "auto" },
      });
    }
  } catch (err) {
    console.warn(`Warning: Could not update display name: ${(err as Error).message}`);
  }
}
