/** Stable setup identifiers owned by routing. */

import { NOTIFICATION_CHANNEL } from "../../../domain/index.js";

/** Channels supported by the setup adapter. */
export const SETUP_NOTIFICATION_CHANNELS = [NOTIFICATION_CHANNEL.TELEGRAM, NOTIFICATION_CHANNEL.WHATSAPP] as const;

/** Stable diagnostic codes produced by strict route validation. */
export const ROUTE_DIAGNOSTIC_CODE = {
  AGENT_NOT_FOUND: "route.agent_not_found",
  CHANNEL_NOT_FOUND: "route.channel_not_found",
  CHANNEL_DISABLED: "route.channel_disabled",
  ACCOUNT_DISABLED: "route.account_disabled",
  BINDING_CONFLICT: "route.binding_conflict",
  ACCOUNT_NOT_FOUND: "route.account_not_found",
  BINDING_NOT_FOUND: "route.binding_not_found",
  BINDING_AGENT_MISMATCH: "route.binding_agent_mismatch",
  DESTINATION_CONFLICT: "route.destination_conflict",
} as const;

/** OpenClaw peer kinds accepted for exact notification destinations. */
export const ROUTE_PEER_KIND = {
  DIRECT: "direct",
  GROUP: "group",
  CHANNEL: "channel",
} as const;

/** OpenClaw topic qualifier inside a group peer identifier. */
export const TOPIC_PEER_SEPARATOR = ":topic:";
