/**
 * Resolves notification bindings and their deterministic provider-facing labels.
 */
import { NOTIFY_LABEL_PREFIX } from "./const.js";
import type { NotificationEndpoint, NotifyBindingRef } from "./types.js";

/**
 * Build the notify label for a channel endpoint.
 *
 * @param binding - Stable channel and endpoint-name reference to encode.
 */
export function getNotifyLabel(binding: NotifyBindingRef): string {
  return `${NOTIFY_LABEL_PREFIX}${binding.channel}:${binding.name}`;
}

/**
 * Resolve a persisted binding reference to its canonical transport endpoint.
 * Falls back to the first endpoint only when no explicit binding exists.
 *
 * @param binding - Optional stable endpoint reference selected by issue state.
 * @param endpoints - Project endpoints eligible to satisfy the binding.
 */
export function resolveNotifyBinding(
  binding: NotifyBindingRef | null | undefined,
  endpoints: readonly NotificationEndpoint[],
): NotificationEndpoint | undefined {
  if (!binding) return endpoints[0];

  return endpoints.find((endpoint) => (
    endpoint.channel === binding.channel && endpoint.name === binding.name
  ));
}
