import type { SoftUnion } from "../../types.js";
import { NOTIFICATION_CHANNEL } from "./const.js";

/** Supported notification channel or messaging platform identifier. */
export type NotificationChannel = SoftUnion<typeof NOTIFICATION_CHANNEL>;

/** Registered messaging endpoint used by a project for notifications. */
export type NotificationEndpoint = {
  /** Unique channel identifier. */
  channelId: string;
  /** Messaging platform type (e.g. telegram, slack). */
  channel: NotificationChannel;
  /** Endpoint display name (e.g. "primary", "dev-chat"). */
  name: string;
  /** Optional account ID for multi-account setups. */
  accountId?: string;
  /** Optional thread or topic ID for forum-style channels. */
  threadId?: string;
};

/** Target endpoint details persisted for issue notifications. */
export type NotifyTarget = {
  /** Notification channel type (e.g. telegram, slack). */
  channel: NotificationChannel;
  /** Channel target name/identifier. */
  name: string;
};
