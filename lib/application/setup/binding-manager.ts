/** Plans exact channel routes without writes and applies bindings through focused mutations. */
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { validateExactRoute } from "./route-validation.js";
import type { SetupRuntime } from "./types.js";
import type { RouteConfig } from "./types.js";

/** Validate and apply a binding against the fresh writable configuration snapshot.
 * @param runtime - SDK configuration mutation transport.
 * @param channel - Destination transport.
 * @param agentId - Exact route owner.
 * @param accountId - Configured channel account.
 * @param peerId - Exact destination peer.
 */
export async function ensureChannelBinding(runtime: SetupRuntime, channel: string, agentId: string, accountId: string, peerId: string): Promise<void> {
  await runtime.config.mutateConfigFile({
    mutate(config) {
      planChannelBinding(config, channel, agentId, accountId, peerId);
      const binding = buildBinding(channel, agentId, accountId, peerId);

      config.bindings ??= [];
      if (config.bindings.some(entry => matchesDestination(entry, binding))) return;
      const index = config.bindings.findIndex(entry => entry.match.channel === channel && entry.match.accountId === binding.match.accountId && !entry.match.peer);

      config.bindings.splice(index < 0 ? config.bindings.length : index, 0, binding);
    },
    afterWrite: { mode: "auto" },
  });
}

/** Validate the proposed route without changing the supplied configuration.
 * @param config - Current or proposed agent configuration.
 * @param channel - Destination transport.
 * @param agentId - Exact route owner.
 * @param accountId - Configured channel account.
 * @param peerId - Exact destination peer.
 */
export function planChannelBinding(config: RouteConfig, channel: string, agentId: string, accountId: string, peerId: string): void {
  const binding = buildBinding(channel, agentId, accountId, peerId);
  const existing = (config.bindings ?? []).filter(entry => matchesDestination(entry, binding));
  const occupied = existing.find(entry => entry.agentId !== agentId);

  if (occupied) throw new Error(`${channel}/${accountId}/${peerId} is already bound to agent "${occupied.agentId}"`);
  const bindings = existing.length ? config.bindings : [binding, ...(config.bindings ?? [])];

  validateExactRoute({ ...config, bindings }, agentId, channel, accountId.trim(), peerId.trim());
}

/** Construct an exact, normalized group destination after checking required fields.
 * @param channel - Destination transport.
 * @param agentId - Exact route owner.
 * @param accountId - Configured account identifier.
 * @param peerId - Destination peer identifier.
 */
function buildBinding(channel: string, agentId: string, accountId: string, peerId: string): NonNullable<OpenClawConfig["bindings"]>[number] {
  if (!accountId.trim()) throw new Error("accountId is required for an exact DevClaw binding");
  if (!peerId.trim()) throw new Error("peerId is required for an exact DevClaw binding");

  return { agentId, match: { channel, accountId: accountId.trim(), peer: { kind: "group", id: peerId.trim() } } };
}

/** Compare normalized endpoint identity without considering its owner.
 * @param entry - Existing route entry.
 * @param binding - Requested destination.
 */
function matchesDestination(entry: NonNullable<RouteConfig["bindings"]>[number], binding: NonNullable<OpenClawConfig["bindings"]>[number]): boolean {
  return entry.match?.channel === binding.match.channel && entry.match.accountId?.trim() === binding.match.accountId && entry.match.peer?.id?.trim() === binding.match.peer?.id;
}
