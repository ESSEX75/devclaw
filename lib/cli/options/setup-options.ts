import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { ExecutionMode, type ExecutionMode as ExecutionModeType } from "../../domain/workflow/index.js";

export type SetupCliOptions = {
  newAgent?: string;
  agent?: string;
  workspace?: string;
  channelBinding?: "telegram" | "whatsapp" | "none";
  channelAccountId?: string;
  channelPeerId?: string;
  migrateFrom?: string;
  ejectDefaults?: boolean;
  projectExecution?: ExecutionModeType;
  [key: string]: string | boolean | undefined;
};

export type ConfiguredAgent = {
  id: string;
  name?: string;
  workspace?: string;
};

export function getDefaultWorkspaceDir(runtime: PluginRuntime): string | undefined {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    return config.agents?.defaults?.workspace ?? undefined;
  } catch {
    return undefined;
  }
}

export function getConfiguredAgents(runtime: PluginRuntime): ConfiguredAgent[] {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    return config.agents?.list ?? [];
  } catch {
    return [];
  }
}

export function formatAgentLabel(agent: ConfiguredAgent): string {
  return agent.name && agent.name !== agent.id ? `${agent.name} (${agent.id})` : agent.id;
}

export function formatSelectedChannelBinding(opts: Pick<SetupCliOptions, "channelBinding" | "channelAccountId" | "channelPeerId">): string {
  if (!opts.channelBinding || opts.channelBinding === "none") return "none";
  const account = opts.channelAccountId?.trim() || "default";
  return opts.channelPeerId?.trim()
    ? `${opts.channelBinding}/${account}/${opts.channelPeerId.trim()}`
    : `${opts.channelBinding}/${account}`;
}

export function normalizeChannelBinding(value: SetupCliOptions["channelBinding"]): "telegram" | "whatsapp" | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (value === "telegram" || value === "whatsapp") return value;
  throw new Error(`Invalid channel binding: ${value}. Use telegram, whatsapp, or none.`);
}

export function normalizeProjectExecution(value: SetupCliOptions["projectExecution"]): ExecutionModeType | undefined {
  if (value === undefined) return undefined;
  if (value === ExecutionMode.PARALLEL || value === ExecutionMode.SEQUENTIAL) return value;
  throw new Error(`Invalid project execution mode: ${value}. Use parallel or sequential.`);
}
