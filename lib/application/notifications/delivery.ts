/** Delivers one rendered notification through runtime or command fallback. */
import type { RunCommand } from "../../context.js";
import type { NotificationChannel } from "../../domain/index.js";
import type { NotificationDeliveryResult, NotificationRuntime } from "./types.js";

/**
 * Send a notification message via the plugin runtime API.
 *
 * Uses the runtime's native send functions to bypass CLI → WebSocket timeouts.
 * Falls back gracefully on error (notifications shouldn't break the main flow).
 * @param target - Validated provider destination identifier.
 * @param message - Already rendered event text.
 * @param channel - Provider channel selected by the exact route.
 * @param accountId - Account bound to the destination.
 * @param runtime - Preferred direct delivery capability when available.
 * @param threadId - Optional provider topic or thread.
 * @param runCommand - Optional command fallback after a runtime failure.
 */
export async function deliverNotificationMessage(
  target: string,
  message: string,
  channel: NotificationChannel,
  accountId: string,
  runtime?: NotificationRuntime,
  threadId?: string,
  runCommand?: RunCommand,
): Promise<NotificationDeliveryResult> {
  let runtimeError: unknown;

  if (runtime) {
    try {
      const adapter: unknown = await runtime.channel.outbound.loadAdapter(channel);

      if (!hasRuntimeSender(adapter)) throw new Error("Runtime notification adapter has no sendText capability.");
      const receipt: unknown = await adapter.sendText({
        cfg: runtime.config.current(),
        to: target,
        text: message,
        silent: true,
        accountId,
        threadId,
      });

      return {
        delivered: true,
        ...(getMessageId(receipt) ? { messageId: getMessageId(receipt) } : {}),
        channel,
        accountId,
        channelId: target,
        threadId,
        path: "runtime",
      };
    } catch (err) {
      runtimeError = err;
    }
  }

  const args = [
    "message",
    "send",
    "--channel",
    channel,
    "--target",
    target,
    "--message",
    message,
    "--json",
  ];

  if (!runCommand) {
    throw new Error(runtimeError
      ? `Runtime notification failed and no command runner is available for fallback: ${errorMessage(runtimeError)}`
      : "No notification delivery path available");
  }

  args.push("--account", accountId);
  if (threadId) args.push("--thread-id", threadId);

  const command = await runCommand(["openclaw", ...args], { timeoutMs: 30_000 });

  if (command.code !== 0) throw new Error(`Notification fallback exited with code ${command.code}: ${command.stderr}`);

  return {
    delivered: true,
    channel,
    accountId,
    channelId: target,
    threadId,
    path: "fallback",
  };
}

/** Direct runtime payload required by a sender adapter. */
type RuntimeSendPayload = {
  /** Runtime route configuration for the selected account. */
  cfg: unknown;
  /** Exact destination identifier. */
  to: string;
  /** Rendered notification text. */
  text: string;
  /** Avoid extra runtime notification noise. */
  silent: boolean;
  /** Selected provider account. */
  accountId?: string;
  /** Optional thread or topic identifier. */
  threadId?: string;
};

/**
 * Check an unknown adapter for the direct text sender capability.
 * @param value - Adapter value returned by the runtime loader.
 */
function hasRuntimeSender(value: unknown): value is {
  sendText(payload: RuntimeSendPayload): Promise<unknown>;
} {
  return typeof value === "object"
    && value !== null
    && "sendText" in value
    && typeof value.sendText === "function";
}

/**
 * Read an optional provider message identifier from a runtime receipt.
 * @param value - Untrusted runtime sender receipt.
 */
function getMessageId(value: unknown): string | undefined {
  return typeof value === "object"
    && value !== null
    && "messageId" in value
    && typeof value.messageId === "string"
    ? value.messageId
    : undefined;
}

/**
 * Format an unknown delivery failure for audit diagnostics.
 * @param error - Failure thrown by runtime or command fallback.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
