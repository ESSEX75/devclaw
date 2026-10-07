/** Sends through OpenClaw once; never retries a possibly delivered message through another path. */

import { isCompletedCommand } from "../../process/index.js";
import { MESSAGE_COMMAND, MESSAGE_DELIVERY_PATH, MESSAGE_DELIVERY_STATUS, MESSAGE_TIMEOUT_MS } from "./const.js";
import { hasTextSender } from "./guards.js";
import type { MessageDeliveryInput, MessageDeliveryOutcome } from "./types.js";

/** Read an optional identifier without claiming that it proves user receipt.
 * @param value - Untrusted transport receipt.
 */
function messageId(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && "messageId" in value && typeof value.messageId === "string" ? value.messageId : undefined;
}

/** Convert a transport failure into diagnostic text.
 * @param error - Thrown provider or command failure.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Bound native acceptance observation without cancelling or repeating the external send.
 * @param send - Already submitted native operation; late settlement remains handled.
 */
async function observeNativeSend(send: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Runtime message acceptance timed out; inspect the destination before retrying.")), MESSAGE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([send, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Deliver once. Loading failures permit CLI fallback; send failures and abnormal command exits remain unknown.
 * @param input - Validated route, immutable config snapshot and injected transports.
 */
export async function deliverNotificationMessage(input: MessageDeliveryInput): Promise<MessageDeliveryOutcome> {
  let adapter: unknown;
  let unavailable = "No notification delivery path available.";

  try {
    adapter = await input.runtime?.outbound.loadAdapter(input.channel);
  } catch (error) {
    unavailable = errorMessage(error);
  }

  if (hasTextSender(adapter)) {
    try {
      const receipt: unknown = await observeNativeSend(adapter.sendText({ cfg: input.config, to: input.target, text: input.message,
        silent: true, accountId: input.accountId, threadId: input.threadId }));

      return { status: MESSAGE_DELIVERY_STATUS.ACCEPTED, delivered: true, path: MESSAGE_DELIVERY_PATH.RUNTIME, messageId: messageId(receipt) };
    } catch (error) {
      return { status: MESSAGE_DELIVERY_STATUS.UNKNOWN, delivered: false, path: MESSAGE_DELIVERY_PATH.RUNTIME, reason: errorMessage(error) };
    }
  }

  if (!input.runCommand) return { status: MESSAGE_DELIVERY_STATUS.REJECTED, delivered: false, reason: unavailable };
  const args = [...MESSAGE_COMMAND.PREFIX, MESSAGE_COMMAND.CHANNEL, input.channel, MESSAGE_COMMAND.TARGET, input.target,
    MESSAGE_COMMAND.MESSAGE, input.message, MESSAGE_COMMAND.JSON, MESSAGE_COMMAND.ACCOUNT, input.accountId];

  if (input.threadId) args.push(MESSAGE_COMMAND.THREAD, input.threadId);
  try {
    const result = await input.runCommand(args, { timeoutMs: MESSAGE_TIMEOUT_MS });

    if (!isCompletedCommand(result) || result.code !== 0) {
      return { status: MESSAGE_DELIVERY_STATUS.UNKNOWN, delivered: false, path: MESSAGE_DELIVERY_PATH.FALLBACK,
        reason: `Notification command exited with code ${result.code}: ${result.stderr}` };
    }

    // A successful CLI exit reports command acceptance; malformed JSON cannot supply a receipt ID.
    let receipt: unknown;

    try { receipt = JSON.parse(result.stdout); } catch { receipt = undefined; }

    return { status: MESSAGE_DELIVERY_STATUS.ACCEPTED, delivered: true, path: MESSAGE_DELIVERY_PATH.FALLBACK, messageId: messageId(receipt) };
  } catch (error) {
    return { status: MESSAGE_DELIVERY_STATUS.UNKNOWN, delivered: false, path: MESSAGE_DELIVERY_PATH.FALLBACK, reason: errorMessage(error) };
  }
}
