/** Delivers optional review events only to the issue's persisted exact endpoint. */

import { log as auditLog } from "../../../audit.js";
import { notify } from "../../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../../notifications/resolve-endpoint.js";
import { HEARTBEAT_AUDIT_EVENT } from "../const.js";
import type { ReviewNotificationInput } from "./types.js";

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
