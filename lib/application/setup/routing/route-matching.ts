/** Matches exact OpenClaw peers against the destination implied by a notification address. */

import { NOTIFICATION_CHANNEL } from "../../../domain/index.js";
import { ROUTE_PEER_KIND } from "./const.js";
import type { RouteConfig } from "./types.js";

/** Infer Telegram DMs from positive numeric user chat IDs; other addresses remain group destinations.
 * Telegram group/supergroup IDs are negative, and topic IDs retain that group prefix.
 * @param channel - Requested transport.
 * @param peerId - Requested destination peer.
 */
export function isDirectDestination(channel: string, peerId: string): boolean {
  return channel === NOTIFICATION_CHANNEL.TELEGRAM && /^[1-9]\d*$/.test(peerId.trim());
}

/** Compare one binding with the exact channel, account, peer kind and peer ID of a destination.
 * Group and channel are equivalent only for group destinations; a direct peer never aliases either.
 * @param binding - Existing SDK binding.
 * @param channel - Requested channel.
 * @param accountId - Requested account identifier.
 * @param peerId - Requested peer or topic identifier.
 */
export function matchesExactDestination(binding: NonNullable<RouteConfig["bindings"]>[number], channel: string, accountId: string, peerId: string): boolean {
  const match = binding.match;
  const kind = match?.peer?.kind;
  const kindMatches = isDirectDestination(channel, peerId)
    ? kind === ROUTE_PEER_KIND.DIRECT
    : kind === ROUTE_PEER_KIND.GROUP || kind === ROUTE_PEER_KIND.CHANNEL;

  return match?.channel === channel && match.accountId?.trim() === accountId.trim()
    && kindMatches && match.peer?.id?.trim() === peerId.trim();
}
