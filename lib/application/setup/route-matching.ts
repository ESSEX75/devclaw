/** Matches exact group routes using OpenClaw's group/channel peer equivalence. */
import { ROUTE_PEER_KIND } from "./const.js";
import type { RouteConfig } from "./types.js";

/** Compare one binding with a complete group destination, independently of its owner.
 * @param binding - Existing SDK binding.
 * @param channel - Requested channel.
 * @param accountId - Requested account identifier.
 * @param peerId - Requested group or topic identifier.
 */
export function matchesGroupDestination(binding: NonNullable<RouteConfig["bindings"]>[number], channel: string, accountId: string, peerId: string): boolean {
  const match = binding.match;

  return match?.channel === channel && match.accountId?.trim() === accountId.trim()
    && (match.peer?.kind === ROUTE_PEER_KIND.GROUP || match.peer?.kind === ROUTE_PEER_KIND.CHANNEL)
    && match.peer.id?.trim() === peerId.trim();
}
