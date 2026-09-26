/** Resolves setup targets, route validation, and model changes without side effects. */
import { loadConfig } from "../../state/index.js";
import { getAgentId, getAgentWorkspacePath, resolveWorkspacePath } from "./agent-config.js";
import { planChannelBinding } from "./binding-manager.js";
import type { ModelConfig, SetupOpts, SetupResult } from "./types.js";

/** Resolve a validated setup plan; performs reads only and never invokes command transport.
 * @param opts - Explicit target and requested operation.
 */
export async function planSetup(opts: SetupOpts): Promise<SetupResult> {
  const fileOperations = [opts.ejectDefaults, opts.resetDefaults, opts.refreshInstructions].filter(Boolean).length;

  if (fileOperations > 1) throw new Error("Choose only one defaults or instruction operation.");
  if (opts.newAgentName && (opts.agentId || opts.workspacePath)) throw new Error("newAgentName cannot be combined with agentId or workspacePath.");
  if (fileOperations && (opts.newAgentName || opts.channelBinding || opts.models || opts.projectExecution)) {
    throw new Error("File operations cannot be combined with agent creation, binding, models, or project execution changes.");
  }

  const agentCreated = Boolean(opts.newAgentName);
  const agentId = opts.newAgentName ? getAgentId(opts.newAgentName) : opts.agentId ?? "unknown";
  const workspacePath = opts.newAgentName ? getAgentWorkspacePath(agentId)
    : opts.workspacePath ?? (opts.agentId ? resolveWorkspacePath(opts.runtime, opts.agentId) : undefined);

  if (!workspacePath) throw new Error("Setup requires either newAgentName, agentId, or workspacePath");
  const current = opts.runtime.config.current();
  const config = { ...current, agents: { ...current.agents, list: [...(current.agents?.list ?? [])] } };

  if (agentCreated) {
    if (config.agents?.list?.some(agent => agent.id === agentId)) throw new Error(`Agent "${agentId}" already exists in openclaw.json.`);
    config.agents.list.push({ id: agentId, workspace: workspacePath });
  } else if (opts.agentId && !config.agents?.list?.some(agent => agent.id === opts.agentId)) {
    throw new Error(`Agent "${agentId}" does not exist.`);
  }

  if (opts.channelBinding) {
    if (!opts.agentId && !opts.newAgentName) throw new Error("Channel binding requires an agent target.");
    if (!opts.channelAccountId?.trim()) throw new Error("channelAccountId is required when configuring a channel binding.");
    if (!opts.channelPeerId?.trim()) throw new Error("channelPeerId is required when configuring a channel binding.");
    planChannelBinding(config, opts.channelBinding, agentId, opts.channelAccountId, opts.channelPeerId);
  } else if (opts.channelAccountId || opts.channelPeerId) {
    throw new Error("Account and peer require channelBinding.");
  }

  // File recovery must remain available even when the existing workflow is invalid.
  const models = fileOperations ? {} : await resolveModels(workspacePath, opts.models);
  const plannedChanges = fileOperations
    ? [opts.resetDefaults ? "Reset packaged defaults with backups" : opts.refreshInstructions ? "Refresh system instructions with backups" : "Create missing packaged defaults"]
    : [
      ...(agentCreated ? [`Create OpenClaw agent "${agentId}"`] : []),
      `Configure DevClaw tool isolation for "${agentId}"`,
      ...(opts.channelBinding ? [`Create exact binding ${opts.channelBinding}/${opts.channelAccountId}/${opts.channelPeerId}`] : []),
      `Create missing workspace files in ${workspacePath}`,
      ...(opts.models ? ["Write explicit model overrides; preserve other configuration"] : []),
    ];
  const result: SetupResult = {
    operation: opts.ejectDefaults ? "eject-defaults" : opts.resetDefaults ? "reset-defaults" : opts.refreshInstructions ? "refresh-instructions" : "configure",
    agentId, agentCreated, workspacePath, models, filesWritten: [], warnings: [],
    channelBinding: opts.channelBinding ?? null, channelAccountId: opts.channelAccountId,
    channelPeerId: opts.channelPeerId, defaultsEjected: opts.ejectDefaults === true,
    dryRun: opts.dryRun === true, plannedChanges,
  };

  return result;
}

/** Resolve custom and built-in levels and reject overrides outside the configured value set.
 * @param workspacePath - Workspace containing the authoritative model configuration.
 * @param overrides - Only explicitly requested model assignments.
 */
async function resolveModels(workspacePath: string, overrides: SetupOpts["models"]): Promise<ModelConfig> {
  const resolved = await loadConfig(workspacePath);
  const models: ModelConfig = {};

  for (const [role, config] of Object.entries(resolved.roles)) {
    models[role] = Object.fromEntries(Object.entries(config.levels).map(([level, definition]) => [level, definition.model]));
  }

  for (const [role, levels] of Object.entries(overrides ?? {})) {
    for (const [level, model] of Object.entries(levels)) {
      if (!Object.hasOwn(resolved.roles, role) || !Object.hasOwn(resolved.roles[role].levels, level)) {
        throw new Error(`Unknown configured model level: ${role}.${level}`);
      }

      if (!resolved.roles[role].enabled) throw new Error(`Disabled configured role: ${role}`);
      if (!model?.trim()) throw new Error(`Empty model for ${role}.${level}`);
      models[role][level] = model;
    }
  }

  return models;
}
