import { NOTIFY_LABEL_PREFIX } from "./const.js";
import type { NotificationChannel, NotificationEndpoint } from "./types.js";

/** Build the notify label for a channel endpoint. */
export function getNotifyLabel(channel: NotificationChannel, nameOrIndex: string): string {
  return `${NOTIFY_LABEL_PREFIX}${channel}:${nameOrIndex}`;
}

/** Resolve an issue's notification endpoint, falling back to the first endpoint. */
export function resolveNotifyChannel(
  issueLabels: readonly string[],
  endpoints: readonly NotificationEndpoint[],
): NotificationEndpoint | undefined {
  const notifyLabel = issueLabels.find((label) => label.startsWith(NOTIFY_LABEL_PREFIX));

  if (!notifyLabel) return endpoints[0];

  const value = notifyLabel.slice(NOTIFY_LABEL_PREFIX.length);
  const separatorIndex = value.indexOf(":");

  if (separatorIndex === -1) return endpoints[0];

  const channel = value.slice(0, separatorIndex);
  const nameOrIndex = value.slice(separatorIndex + 1);

  return endpoints.find((endpoint, index) => (
    endpoint.channel === channel
    && (endpoint.name === nameOrIndex || String(index) === nameOrIndex)
  )) ?? endpoints[0];
}
