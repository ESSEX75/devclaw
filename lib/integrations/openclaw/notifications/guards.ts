/** Validates native outbound capabilities before a notification send. */

import type { TextSender } from "./types.js";

/** Validate the capability without assuming a provider adapter shape.
 * @param value - Untrusted loaded adapter.
 */
export function hasTextSender(value: unknown): value is TextSender {
  return typeof value === "object" && value !== null && "sendText" in value && typeof value.sendText === "function";
}
