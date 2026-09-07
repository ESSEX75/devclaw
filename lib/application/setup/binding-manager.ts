/**
 * binding-manager.ts — Channel binding analysis and migration.
 *
 * Handles detection of existing channel bindings, channel availability,
 * and safe migration of bindings between agents.
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";

import { validateExactRoute } from "./route-validation.js";

export type ChannelType = string;

/**
 * Ensure an exact account and peer binding exists for an agent.
 */
export async function ensureChannelBinding(
  api: OpenClawPluginApi | PluginRuntime,
  channel: ChannelType,
  agentId: string,
  accountId: string,
  peerId: string,
): Promise<void> {
  const runtime = "runtime" in api ? api.runtime : api;
  const cfg = structuredClone(runtime.config.current()) as OpenClawConfig;

  cfg.bindings ??= [];
  const normalizedAccountId = requireBindingValue(accountId, "accountId");
  const normalizedPeerId = normalizeBindingPeerId(peerId);

  if (!normalizedPeerId) throw new Error("peerId is required for an exact DevClaw binding");

  const existing = cfg.bindings.find(
    (binding) =>
      binding.match?.channel === channel &&
      binding.match.accountId === normalizedAccountId &&
      normalizeBindingPeerId(binding.match.peer?.id) === normalizedPeerId &&
      binding.agentId === agentId,
  );

  if (existing) return;

  const occupied = cfg.bindings.find(
    (binding) =>
      binding.match?.channel === channel &&
      binding.match.accountId === normalizedAccountId &&
      normalizeBindingPeerId(binding.match.peer?.id) === normalizedPeerId,
  );

  if (occupied?.agentId) {
    throw new Error(
      `${channel}/${normalizedAccountId}/${normalizedPeerId} is already bound to agent "${occupied.agentId}"`,
    );
  }

  const nextBinding: NonNullable<OpenClawConfig["bindings"]>[number] = {
    match: {
      channel,
      accountId: normalizedAccountId,
      peer: { kind: "group", id: normalizedPeerId },
    },
    agentId,
  };

  const insertAt = normalizedPeerId
    ? cfg.bindings.findIndex(
      (binding) =>
        binding.match?.channel === channel &&
        binding.match.accountId === normalizedAccountId &&
        !binding.match.peer,
    )
    : -1;

  if (insertAt === -1) {
    cfg.bindings.push(nextBinding);
  } else {
    cfg.bindings.splice(insertAt, 0, nextBinding);
  }

  validateExactRoute(cfg, agentId, channel, normalizedAccountId, normalizedPeerId);

  await runtime.config.replaceConfigFile({
    nextConfig: cfg,
    afterWrite: { mode: "auto" },
  });
}

function requireBindingValue(value: string, name: string): string {
  const normalized = value.trim();

  if (!normalized) throw new Error(`${name} is required for an exact DevClaw binding`);

  return normalized;
}

function normalizeBindingPeerId(peerId: string | undefined | null): string | undefined {
  const normalized = peerId?.trim();

  return normalized || undefined;
}
