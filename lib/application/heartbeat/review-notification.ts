/** Delivers optional review events only to the issue's persisted exact endpoint. */

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import { getNotificationConfig, type NotificationRuntime, notify, type NotifyEvent } from "../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../notifications/resolve-endpoint.js";
import { HEARTBEAT_AUDIT_EVENT } from "./const.js";

/** One optional review event and the capabilities needed for exact routing. */
type ReviewNotificationInput = {
  /** Workspace containing local issue binding and audit. */
  workspaceDir: string;
  /** Owning project and its current endpoint registry. */
  project: Project;
  /** Provider-local issue whose binding is resolved. */
  issueId: number;
  /** Complete message to render for the recipient. */
  event: NotifyEvent;
  /** Event policy from plugin configuration. */
  config: ReturnType<typeof getNotificationConfig>;
  /** Native OpenClaw route and sender. */
  runtime?: NotificationRuntime;
  /** Fallback command capability. */
  runCommand: RunCommand;
};

/** Send a review event using the same binding resolver as pipeline notifications.
 * An absent or stale binding produces a blocked notification diagnostic; no primary-channel fallback is used.
 * @param input - Issue identity, project endpoints, event, and delivery capabilities.
 */
export async function notifyReviewEvent(input: ReviewNotificationInput): Promise<void> {
  const { workspaceDir, project, issueId, event, config, runtime, runCommand } = input;

  try {
    const target = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);

    await notify(event, { workspaceDir, config, channelId: target?.channelId, channel: target?.channel,
      accountId: target?.accountId, threadId: target?.threadId, agentId: project.agentId, runtime, runCommand });
  } catch (error) {
    await auditLog(workspaceDir, HEARTBEAT_AUDIT_EVENT.REVIEW_NOTIFICATION_ERROR, { projectSlug: project.slug, issueId,
      event: event.type, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
  }
}
