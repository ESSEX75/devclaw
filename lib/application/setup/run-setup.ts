/**
 * application/setup/run-setup.ts — DevClaw setup orchestrator.
 *
 * Coordinates: agent creation → plugin config → workspace scaffolding → model config.
 * Used by both the `setup` tool and the `openclaw devclaw setup` CLI command.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import YAML from "yaml";

import {
  type ExecutionMode,
  NOTIFICATION_CHANNEL,
  type NotificationChannel,
} from "../../domain/index.js";
import { getAllDefaultModels } from "../../roles/index.js";
import { DATA_DIR } from "../../state/setup/paths.js";
import { scaffoldWorkspace, writeAllDefaults } from "../../state/setup/workspace-files.js";
import {
  createAgent,
  getAgentId,
  getAgentWorkspacePath,
  resolveWorkspacePath,
} from "./agent-config.js";
import { ensureChannelBinding } from "./binding-manager.js";
import { writePluginConfig } from "./plugin-config.js";

export type ModelConfig = Record<string, Record<string, string>>;

export type SetupNotificationChannel = Extract<
  NotificationChannel,
  typeof NOTIFICATION_CHANNEL.TELEGRAM | typeof NOTIFICATION_CHANNEL.WHATSAPP
>;

export const SETUP_NOTIFICATION_CHANNELS: readonly SetupNotificationChannel[] = [
  NOTIFICATION_CHANNEL.TELEGRAM,
  NOTIFICATION_CHANNEL.WHATSAPP,
];

export function isSetupNotificationChannel(value: unknown): value is SetupNotificationChannel {
  return SETUP_NOTIFICATION_CHANNELS.some((channel) => channel === value);
}

export type SetupOpts = {
  /** OpenClaw plugin runtime for config access. */
  runtime: PluginRuntime;
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
  /** Model overrides per role.level. Missing levels use defaults. */
  models?: Record<string, Partial<Record<string, string>>>;
  /** Explicitly write packaged defaults into the workspace. Existing files are preserved. */
  ejectDefaults?: boolean;
  /** Plugin-level project execution mode: parallel or sequential. Default: parallel. */
  projectExecution?: ExecutionMode;
  /** Compute and validate the setup plan without writing configuration or workspace files. */
  dryRun?: boolean;
};

export type SetupResult = {
  agentId: string;
  agentCreated: boolean;
  workspacePath: string;
  models: ModelConfig;
  filesWritten: string[];
  warnings: string[];
  channelBinding?: SetupNotificationChannel | null;
  channelAccountId?: string;
  channelPeerId?: string;
  defaultsEjected?: boolean;
  dryRun: boolean;
  plannedChanges: string[];
};

/**
 * Run the full DevClaw setup.
 *
 * 1. Create agent (optional) or resolve existing workspace
 * 2. Write plugin config to openclaw.json (heartbeat, tool restrictions — no models)
 * 3. Write workspace files (AGENTS.md, HEARTBEAT.md, workflow.yaml, prompts)
 * 4. Write model config to workflow.yaml (single source of truth)
 */
export async function runSetup(opts: SetupOpts): Promise<SetupResult> {
  const warnings: string[] = [];

  validateRequestedBinding(opts);

  if (opts.dryRun) return previewSetup(opts, warnings);

  const { agentId, workspacePath, agentCreated } = await resolveOrCreateAgent(opts);

  await writePluginConfig(opts.runtime, agentId, opts.projectExecution);

  const defaultWorkspacePath = getDefaultWorkspacePath(opts.runtime);
  const filesWritten = await scaffoldWorkspace(workspacePath, defaultWorkspacePath);

  if (opts.ejectDefaults) {
    filesWritten.push(...await writeAllDefaults(workspacePath, false));
  }

  const models = buildModelConfig(opts.models);

  await writeModelsToWorkflow(workspacePath, models);

  return {
    agentId,
    agentCreated,
    workspacePath,
    models,
    filesWritten: [...new Set(filesWritten)],
    warnings,
    channelBinding: opts.channelBinding ?? null,
    channelAccountId: opts.channelAccountId,
    channelPeerId: opts.channelPeerId,
    defaultsEjected: opts.ejectDefaults === true,
    dryRun: false,
    plannedChanges: [],
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function resolveOrCreateAgent(
  opts: SetupOpts,
): Promise<{
  agentId: string;
  workspacePath: string;
  agentCreated: boolean;
}> {
  if (opts.newAgentName) {
    const { agentId, workspacePath } = await createAgent(
      opts.runtime,
      opts.newAgentName,
    );

    if (opts.channelBinding && opts.channelAccountId && opts.channelPeerId) {
      await ensureChannelBinding(opts.runtime, opts.channelBinding, agentId, opts.channelAccountId, opts.channelPeerId);
    }

    return { agentId, workspacePath, agentCreated: true };
  }

  if (opts.agentId) {
    const workspacePath = opts.workspacePath ?? resolveWorkspacePath(opts.runtime, opts.agentId);

    if (opts.channelBinding && opts.channelAccountId && opts.channelPeerId) {
      await ensureChannelBinding(opts.runtime, opts.channelBinding, opts.agentId, opts.channelAccountId, opts.channelPeerId);
    }

    return { agentId: opts.agentId, workspacePath, agentCreated: false };
  }

  if (opts.workspacePath) {
    if (opts.channelBinding) {
      throw new Error("Channel binding requires an agent target. Use --agent or --new-agent, not --workspace.");
    }

    return { agentId: "unknown", workspacePath: opts.workspacePath, agentCreated: false };
  }

  throw new Error("Setup requires either newAgentName, agentId, or workspacePath");
}

function validateRequestedBinding(opts: SetupOpts): void {
  if (!opts.channelBinding) return;
  if (!opts.channelAccountId?.trim()) {
    throw new Error("channelAccountId is required when configuring a channel binding.");
  }

  if (!opts.channelPeerId?.trim()) {
    throw new Error("channelPeerId is required when configuring a channel binding.");
  }
}

function previewSetup(opts: SetupOpts, warnings: string[]): SetupResult {
  let agentId: string;
  let workspacePath: string;
  let agentCreated = false;

  if (opts.newAgentName) {
    agentId = getAgentId(opts.newAgentName);
    workspacePath = getAgentWorkspacePath(agentId);
    agentCreated = true;
  } else if (opts.agentId) {
    agentId = opts.agentId;
    workspacePath = opts.workspacePath ?? resolveWorkspacePath(opts.runtime, agentId);
  } else if (opts.workspacePath) {
    agentId = "unknown";
    workspacePath = opts.workspacePath;
  } else {
    throw new Error("Setup requires either newAgentName, agentId, or workspacePath");
  }

  const plannedChanges = [
    ...(agentCreated ? [`Create OpenClaw agent "${agentId}"`] : []),
    `Configure DevClaw tool isolation for "${agentId}"`,
    ...(opts.channelBinding && opts.channelAccountId && opts.channelPeerId
      ? [`Create exact binding ${opts.channelBinding}/${opts.channelAccountId}/${opts.channelPeerId}`]
      : []),
    `Scaffold workspace ${workspacePath}`,
    "Write resolved model configuration",
  ];

  return {
    agentId,
    agentCreated,
    workspacePath,
    models: buildModelConfig(opts.models),
    filesWritten: [],
    warnings,
    channelBinding: opts.channelBinding ?? null,
    channelAccountId: opts.channelAccountId,
    channelPeerId: opts.channelPeerId,
    defaultsEjected: opts.ejectDefaults === true,
    dryRun: true,
    plannedChanges,
  };
}

function buildModelConfig(overrides?: SetupOpts["models"]): ModelConfig {
  const defaults = getAllDefaultModels();
  const result: ModelConfig = {};

  for (const [role, levels] of Object.entries(defaults)) {
    result[role] = { ...levels };
  }

  if (overrides) {
    for (const [role, roleOverrides] of Object.entries(overrides)) {
      if (!result[role]) result[role] = {};
      for (const [level, model] of Object.entries(roleOverrides)) {
        if (model) result[role][level] = model;
      }
    }
  }

  return result;
}

function getDefaultWorkspacePath(runtime: PluginRuntime): string | undefined {
  try {
    const config = runtime.config.current();

    return config.agents?.defaults?.workspace ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write model configuration to workflow.yaml (single source of truth).
 * Uses YAML Document API to preserve comments and formatting.
 */
async function writeModelsToWorkflow(workspacePath: string, models: ModelConfig): Promise<void> {
  const workflowPath = path.join(workspacePath, DATA_DIR, "workflow.yaml");

  let content = "";

  try {
    content = await fs.readFile(workflowPath, "utf-8");
  } catch { /* file doesn't exist yet */ }

  // Parse as Document to preserve comments
  const doc = content ? YAML.parseDocument(content) : new YAML.Document({});

  // Ensure roles section exists
  if (!doc.has("roles")) {
    doc.set("roles", {});
  }

  const roles = doc.getIn(["roles"], true) as unknown as YAML.YAMLMap;

  // Merge models into roles section
  for (const [role, levels] of Object.entries(models)) {
    if (!roles.has(role)) {
      roles.set(role, doc.createNode({ models: levels }));
    } else {
      const roleNode = roles.get(role, true) as unknown as YAML.YAMLMap;

      roleNode.set("models", doc.createNode(levels));
    }
  }

  await fs.writeFile(workflowPath, doc.toString({ lineWidth: 120 }), "utf-8");
}
