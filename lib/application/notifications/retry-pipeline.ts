/** Rechecks safely retryable terminal notifications while preserving uncertain delivery evidence. */

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { ISSUE_INTEGRITY_STATUS, PIPELINE_NOTIFICATION_STATUS, type Project } from "../../domain/index.js";
import { MESSAGE_DELIVERY_STATUS } from "../../integrations/openclaw/notifications/index.js";
import type { IssueReader } from "../../integrations/providers/index.js";
import { readIssueStateStore, reservePipelineNotification } from "../../state/index.js";
import { NOTIFICATION_AUDIT, NOTIFICATION_BLOCKED, NOTIFICATION_EVENT } from "./const.js";
import { getNotificationConfig, notify } from "./notify.js";
import { recordPipelineNotificationOutcome } from "./record-outcome.js";
import { resolveIssueNotificationEndpoint } from "./resolve-endpoint.js";
import type { NotificationDeliveryResult, NotificationRuntime } from "./types.js";

/** Retry a bounded batch of proven unsubmitted events. Expired in-flight sends become unknown, never retried.
 * @param workspaceDir - Workspace containing authoritative state.
 * @param project - Project owning pending events.
 * @param provider - Provider used to refresh title and URL before sending.
 * @param pluginConfig - Current event toggles.
 * @param runtime - Native adapter and exact route configuration.
 * @param runCommand - Optional CLI fallback before native submission.
 * @param maxItems - Maximum pending candidates examined in this pass.
 */
export async function retryPendingPipelineNotifications(
  workspaceDir: string, project: Project, provider: IssueReader,
  pluginConfig: Record<string, unknown> | undefined, runtime: NotificationRuntime | undefined,
  runCommand: RunCommand, maxItems: number,
): Promise<number> {
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const pending = Object.values(store.issues).filter((state) => state.pipelineNotification
    && !state.pendingWorkerRelease && !state.activeWorker
    && state.integrityStatus === ISSUE_INTEGRITY_STATUS.OK
    && state.pipelineNotification.status !== PIPELINE_NOTIFICATION_STATUS.DELIVERED
    && state.pipelineNotification.status !== PIPELINE_NOTIFICATION_STATUS.UNKNOWN)
    .sort((left, right) => Date.parse(left.pipelineNotification!.attemptedAt) - Date.parse(right.pipelineNotification!.attemptedAt));
  const config = getNotificationConfig(pluginConfig);
  let delivered = 0;

  for (const state of pending.slice(0, Math.max(0, maxItems))) {
    const eventKey = state.pipelineNotification?.eventKey;

    if (!eventKey) continue;
    const token = await reservePipelineNotification(workspaceDir, project.slug, state.issueId, eventKey);

    if (!token) continue;
    let outcome: NotificationDeliveryResult;
    let deliveryStarted = false;

    try {
      if (config[NOTIFICATION_EVENT.PIPELINE_COMPLETE] === false) {
        outcome = { status: NOTIFICATION_BLOCKED, delivered: false, reason: "Notification event is disabled." };
      } else {
        const endpoint = await resolveIssueNotificationEndpoint(workspaceDir, project, state.issueId);

        if (!endpoint) {
          outcome = { status: NOTIFICATION_BLOCKED, delivered: false, reason: "Stored notification endpoint is missing; restore the exact binding." };
        } else {
          // Provider and route reads precede all external delivery effects.
          const issue = await provider.getIssue(state.issueId);

          deliveryStarted = true;
          outcome = await notify({
            type: NOTIFICATION_EVENT.PIPELINE_COMPLETE, project: project.name, issueId: state.issueId,
            issueTitle: issue.title, issueUrl: issue.web_url, terminalState: state.workflowLabel,
            issueClosed: state.closedAt !== null,
          }, { workspaceDir, config, channelId: endpoint.channelId, channel: endpoint.channel,
            threadId: endpoint.threadId, runtime, accountId: endpoint.accountId, agentId: project.agentId, runCommand });
        }
      }
    } catch (error) {
      // An unexpected orchestration exception is not proof that transport did not run.
      outcome = { status: deliveryStarted ? MESSAGE_DELIVERY_STATUS.UNKNOWN : NOTIFICATION_BLOCKED, delivered: false,
        reason: error instanceof Error ? error.message : String(error) };
    }

    try {
      const recorded = await recordPipelineNotificationOutcome(workspaceDir, project.slug, state.issueId, eventKey, token, outcome);

      if (recorded && outcome.delivered) delivered++;
    } catch (error) {
      await auditLog(workspaceDir, NOTIFICATION_AUDIT.RETRY_FAILED, {
        projectSlug: project.slug, issueId: state.issueId, eventKey,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
  }

  return delivered;
}
