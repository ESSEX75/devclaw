/** Maps transport evidence and policy decisions into the owned terminal outbox attempt. */

import { PIPELINE_NOTIFICATION_STATUS } from "../../domain/index.js";
import { MESSAGE_DELIVERY_STATUS } from "../../integrations/openclaw/notifications/index.js";
import { settlePipelineNotification } from "../../state/index.js";
import { NOTIFICATION_BLOCKED } from "./const.js";
import type { NotificationDeliveryResult } from "./types.js";

/** Persist only the matching attempt; storage failure leaves the reservation unresolved.
 * @param workspaceDir - Workspace containing authoritative state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Managed issue identifier.
 * @param eventKey - Reserved terminal event identity.
 * @param attemptedAt - Token returned by reservation.
 * @param outcome - Transport evidence or pre-send policy block.
 */
export async function recordPipelineNotificationOutcome(
  workspaceDir: string, projectSlug: string, issueId: number, eventKey: string, attemptedAt: string,
  outcome: NotificationDeliveryResult,
): Promise<boolean> {
  const status = outcome.delivered ? PIPELINE_NOTIFICATION_STATUS.DELIVERED
    : outcome.status === MESSAGE_DELIVERY_STATUS.UNKNOWN ? PIPELINE_NOTIFICATION_STATUS.UNKNOWN
      : outcome.status === NOTIFICATION_BLOCKED ? PIPELINE_NOTIFICATION_STATUS.BLOCKED : PIPELINE_NOTIFICATION_STATUS.RETRYABLE;

  return settlePipelineNotification(workspaceDir, projectSlug, issueId, eventKey, attemptedAt, status,
    outcome.delivered ? undefined : outcome.reason);
}
