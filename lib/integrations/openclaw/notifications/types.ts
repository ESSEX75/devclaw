/** Narrow outbound capabilities and evidence returned by OpenClaw message transport. */

import type { RunCommand } from "../../../context.js";
import type { NotificationChannel } from "../../../domain/index.js";
import type { ValueOf } from "../../../types.js";
import type { MESSAGE_DELIVERY_PATH, MESSAGE_DELIVERY_STATUS } from "./const.js";

/** Runtime channel loader; application owns route validation before sending. */
export type NotificationChannelRuntime = {
  /** Outbound provider adapters. */
  outbound: {
    /** Load a provider adapter, without sending a message.
     * @param channel - Validated provider channel.
     */
    loadAdapter(channel: string): Promise<unknown>;
  };
};

/** Validated routing and transport dependencies for a single send. */
export type MessageDeliveryInput = {
  /** Exact destination; never replaced by a default. */
  target: string;
  /** Already rendered text. */
  message: string;
  /** Selected provider. */
  channel: NotificationChannel;
  /** Explicit account binding. */
  accountId: string;
  /** Optional destination thread. */
  threadId?: string;
  /** Route configuration snapshot already validated by application. */
  config: unknown;
  /** Optional native outbound adapter. */
  runtime?: NotificationChannelRuntime;
  /** Command transport used only before any native send begins. */
  runCommand?: RunCommand;
};

/** Shared transport receipt metadata. */
type DeliveryMetadata = {
  /** Transport used, absent when none was available. */
  path?: ValueOf<typeof MESSAGE_DELIVERY_PATH>;
  /** Provider receipt identifier when supplied. */
  messageId?: string;
};

/** Transport reported acceptance; recipient reading or workflow completion is not implied. */
type AcceptedMessageDelivery = {
  /** Confirmed command/native-send acceptance. */
  status: typeof MESSAGE_DELIVERY_STATUS.ACCEPTED;
  /** Positive acceptance evidence. */
  delivered: true;
};

/** No send began, or a submitted operation has an uncertain external outcome. */
type UnconfirmedMessageDelivery = {
  /** Proven local rejection or unresolved submitted delivery. */
  status: typeof MESSAGE_DELIVERY_STATUS.REJECTED | typeof MESSAGE_DELIVERY_STATUS.UNKNOWN;
  /** Acceptance has not been established. */
  delivered: false;
  /** Operator diagnostic; unknown outcomes require inspection before retry. */
  reason: string;
};

/** Acceptance, proven local rejection, or uncertain external outcome with optional receipt metadata. */
export type MessageDeliveryOutcome = DeliveryMetadata & (AcceptedMessageDelivery | UnconfirmedMessageDelivery);

/** Native adapter payload derived from the exact application-selected route. */
type RuntimeSendPayload = {
  /** Validated configuration snapshot. */
  cfg: unknown;
  /** Exact destination identifier. */
  to: string;
  /** Rendered event text. */
  text: string;
  /** Quiet provider delivery. */
  silent: boolean;
  /** Explicit account binding. */
  accountId: string;
  /** Optional topic or thread. */
  threadId?: string;
};

/** Native text submission capability validated at the transport boundary. */
export type TextSender = {
  /** Submit rendered text with its explicit destination.
   * @param payload - Validated routing and rendered message.
   */
  sendText(payload: RuntimeSendPayload): Promise<unknown>;
};
