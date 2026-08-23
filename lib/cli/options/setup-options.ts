import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import {
  isSetupNotificationChannel,
  type SetupNotificationChannel,
} from "../../application/setup/run-setup.js";
import { EXECUTION_MODE, type ExecutionMode } from "../../domain/index.js";

export type SetupCliOptions = {
  newAgent?: string;
  agent?: string;
  workspace?: string;
  channelBinding?: SetupNotificationChannel | "none";
  channelAccountId?: string;
  channelPeerId?: string;
  migrateFrom?: string;
  ejectDefaults?: boolean;
  projectExecution?: ExecutionMode;
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

export function normalizeChannelBinding(
  value: SetupCliOptions["channelBinding"],
): SetupNotificationChannel | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (isSetupNotificationChannel(value)) return value;
  throw new Error(`Invalid channel binding: ${value}. Use telegram, whatsapp, or none.`);
}

export function normalizeProjectExecution(value: SetupCliOptions["projectExecution"]): ExecutionMode | undefined {
  if (value === undefined) return undefined;
  if (value === EXECUTION_MODE.PARALLEL || value === EXECUTION_MODE.SEQUENTIAL) return value;
  throw new Error(`Invalid project execution mode: ${value}. Use parallel or sequential.`);
}
