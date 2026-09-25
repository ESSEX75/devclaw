/** Coordinates notification routing, delivery outcomes, and audit records. */
import { randomUUID } from "node:crypto";

import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { inspectProjectRoute } from "../setup/route-validation.js";
import { auditNotificationOutcome } from "./audit.js";
import { NOTIFICATION_EVENT_TYPES } from "./const.js";
import { deliverNotificationMessage, errorMessage } from "./delivery.js";
import { renderNotificationMessage } from "./render.js";
import type { NotificationConfig, NotificationDeliveryResult, NotificationTarget, NotifyEvent, NotifyOptions } from "./types.js";

/**
 * Send a notification for a worker lifecycle event.
 *
 * Returns a receipt only after runtime or fallback delivery succeeds.
 * @param event - Worker or pipeline event to deliver.
 * @param opts - Exact route and transport dependencies for the attempt.
 */
export async function notify(
  event: NotifyEvent,
  opts: NotifyOptions,
): Promise<NotificationDeliveryResult | null> {
  if (opts.config?.[event.type] === false) return null;

  const channel = opts.channel ?? NOTIFICATION_CHANNEL.TELEGRAM;
  const message = renderNotificationMessage(event);
  const target = opts.channelId;

  if (!target) {
    await auditNotificationOutcome(opts.workspaceDir, event, { kind: "skip", reason: "no target" });

    return null;
  }

  if (!opts.accountId || !opts.agentId || !opts.runtime) {
    await auditNotificationOutcome(opts.workspaceDir, event, {
      kind: "configuration_error",
      reason: "notification route requires explicit accountId, agentId, and runtime configuration",
    });

    return null;
  }

  const targetData: NotificationTarget = {
    channel,
    agentId: opts.agentId,
    accountId: opts.accountId,
    channelId: target,
    threadId: opts.threadId,
  };
  const routeDiagnostics = inspectProjectRoute(
    opts.runtime.config.current(),
    opts.agentId,
    {
      channelId: target,
      channel,
      name: "delivery",
      accountId: opts.accountId,
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
    },
  );

  if (routeDiagnostics.length > 0) {
    await auditNotificationOutcome(opts.workspaceDir, event, {
      kind: "configuration_error", reason: "invalid route", target: targetData, diagnostics: routeDiagnostics,
    });

    return null;
  }

  const eventId = randomUUID();
  const deliveryPaths = [opts.runtime ? "runtime" : null, opts.runCommand ? "fallback" : null]
    .filter((path): path is string => path !== null);

  await auditNotificationOutcome(opts.workspaceDir, event, { kind: "attempt", eventId, target: targetData, paths: deliveryPaths });

  let result: NotificationDeliveryResult;

  try {
    result = await deliverNotificationMessage(
      target,
      message,
      channel,
      opts.accountId,
      opts.runtime,
      opts.threadId,
      opts.runCommand,
    );
  } catch (error) {
    await auditNotificationOutcome(opts.workspaceDir, event, {
      kind: "failed", eventId, target: targetData, paths: deliveryPaths, error: errorMessage(error),
    });

    return null;
  }

  await auditNotificationOutcome(opts.workspaceDir, event, {
    kind: "sent", eventId, target: targetData, receipt: result,
  }).catch(() => { /* Delivery succeeded; audit failure must not trigger an outbox retry. */ });

  return result;
}

/**
 * Extract notification config from plugin config.
 * All event types default to enabled (true).
 * @param pluginConfig - Untrusted plugin configuration at the application boundary.
 */
export function getNotificationConfig(
  pluginConfig?: Record<string, unknown>,
): NotificationConfig {
  const raw = pluginConfig?.notifications;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const config: NotificationConfig = {};

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    const enabled = Reflect.get(raw, eventType);

    if (typeof enabled === "boolean") config[eventType] = enabled;
  }

  return config;
}
