/** Transport outcomes and OpenClaw message command protocol. */

/** Evidence available after a single transport attempt. */
export const MESSAGE_DELIVERY_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNKNOWN: "unknown",
} as const;

/** Supported transport paths. */
export const MESSAGE_DELIVERY_PATH = {
  RUNTIME: "runtime",
  FALLBACK: "fallback",
} as const;

/** CLI command and flags for one text message. */
export const MESSAGE_COMMAND = {
  PREFIX: ["openclaw", "message", "send"],
  CHANNEL: "--channel",
  TARGET: "--target",
  MESSAGE: "--message",
  JSON: "--json",
  ACCOUNT: "--account",
  THREAD: "--thread-id",
} as const;

/** Upper bound passed to the command runner. Timeout does not establish non-delivery. */
export const MESSAGE_TIMEOUT_MS = 30_000;
