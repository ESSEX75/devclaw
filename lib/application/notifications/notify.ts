/** Coordinates event policy, exact routing, transport evidence and best-effort audit. */

import { randomUUID } from "node:crypto";

import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { deliverNotificationMessage, MESSAGE_DELIVERY_PATH } from "../../integrations/index.js";
import { inspectProjectRoute } from "../setup/index.js";
import { auditNotificationOutcome } from "./audit.js";
import { NOTIFICATION_AUDIT_OUTCOME, NOTIFICATION_BLOCK_REASON, NOTIFICATION_BLOCKED, NOTIFICATION_EVENT_TYPES } from "./const.js";
import { renderNotificationMessage } from "./render.js";
import type { NotificationConfig, NotificationDeliveryResult, NotificationRuntime, NotificationTarget, NotifyEvent, NotifyOptions } from "./types.js";

/** Deliver a lifecycle event once, preserving evidence when external acceptance is uncertain.
 * Audit failure never changes the transport outcome.
 * @param event - Event to render and send.
 * @param opts - Exact route and transport dependencies.
 */
export async function notify(event: NotifyEvent, opts: NotifyOptions): Promise<NotificationDeliveryResult> {
  if (opts.config?.[event.type] === false) {
    await auditNotificationOutcome(opts.workspaceDir, event, { kind: NOTIFICATION_AUDIT_OUTCOME.SKIP, reason: "event disabled" }).catch(() => {});

    return { status: NOTIFICATION_BLOCKED, delivered: false, reason: NOTIFICATION_BLOCK_REASON.EVENT_DISABLED };
  }

  const channel = opts.channel ?? NOTIFICATION_CHANNEL.TELEGRAM;
  const target = opts.channelId;

  if (!target || !opts.accountId || !opts.agentId || !opts.runtime) {
    const reason = "Notification requires an exact target, account, agent and runtime configuration.";

    await auditNotificationOutcome(opts.workspaceDir, event, { kind: NOTIFICATION_AUDIT_OUTCOME.CONFIGURATION_ERROR, reason }).catch(() => {});

    return { status: NOTIFICATION_BLOCKED, delivered: false, reason };
  }

  const targetData: NotificationTarget = { channel, agentId: opts.agentId, accountId: opts.accountId, channelId: target, threadId: opts.threadId };
  let config: ReturnType<NotificationRuntime["config"]["current"]>;

  try {
    config = opts.runtime.config.current();
    const diagnostics = inspectProjectRoute(config, opts.agentId, {
      channelId: target, channel, name: "delivery", accountId: opts.accountId,
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
    });

    if (diagnostics.length > 0) {
      await auditNotificationOutcome(opts.workspaceDir, event, {
        kind: NOTIFICATION_AUDIT_OUTCOME.CONFIGURATION_ERROR, reason: "invalid route", target: targetData, diagnostics,
      }).catch(() => {});

      return { status: NOTIFICATION_BLOCKED, delivered: false, reason: diagnostics.map((item) => item.message).join("; ") };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await auditNotificationOutcome(opts.workspaceDir, event, {
      kind: NOTIFICATION_AUDIT_OUTCOME.CONFIGURATION_ERROR, reason, target: targetData,
    }).catch(() => {});

    return { status: NOTIFICATION_BLOCKED, delivered: false, reason };
  }

  const eventId = randomUUID();
  const paths = [MESSAGE_DELIVERY_PATH.RUNTIME, ...(opts.runCommand ? [MESSAGE_DELIVERY_PATH.FALLBACK] : [])];

  await auditNotificationOutcome(opts.workspaceDir, event, { kind: NOTIFICATION_AUDIT_OUTCOME.ATTEMPT, eventId, target: targetData, paths }).catch(() => {});
  const result = await deliverNotificationMessage({
    target, message: renderNotificationMessage(event), channel, accountId: opts.accountId,
    runtime: opts.runtime.channel, config, threadId: opts.threadId, runCommand: opts.runCommand,
  });

  await auditNotificationOutcome(opts.workspaceDir, event, result.delivered
    ? { kind: NOTIFICATION_AUDIT_OUTCOME.SENT, eventId, target: targetData, receipt: result }
    : { kind: NOTIFICATION_AUDIT_OUTCOME.FAILED, eventId, target: targetData, paths, error: result.reason, status: result.status }).catch(() => {});

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
