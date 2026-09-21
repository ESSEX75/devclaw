/**
 * Retries durable terminal pipeline notifications before heartbeat archives their issue state.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { PIPELINE_NOTIFICATION_STATUS, type Project } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import {
  confirmPipelineNotification,
  readIssueStateStore,
  reservePipelineNotification,
} from "../../state/index.js";
import { getNotificationConfig, type NotificationRuntime, notify } from "./notify.js";
import { resolveIssueNotificationEndpoint } from "./resolve-endpoint.js";

/**
 * Retry a bounded batch of expired terminal-notification attempts.
 * Live leases are left untouched, and successful delivery is durably confirmed before archival may proceed.
 *
 * @param workspaceDir - Workspace containing authoritative managed issue state.
 * @param project - Project whose pending terminal notifications are retried.
 * @param provider - Provider used to refresh issue title and URL for the notification.
 * @param pluginConfig - Plugin notification toggles applied to retry delivery.
 * @param runtime - OpenClaw runtime used for routed notification delivery.
 * @param runCommand - Command runner available as the notification fallback path.
 * @param maxItems - Maximum number of expired attempts reserved during this pass.
 */
export async function retryPendingPipelineNotifications(
  workspaceDir: string,
  project: Project,
  provider: IssueProvider,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: NotificationRuntime | undefined,
  runCommand: RunCommand,
  maxItems: number,
): Promise<number> {
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const pending = Object.values(store.issues).filter(
    (state) => state.pipelineNotification?.status === PIPELINE_NOTIFICATION_STATUS.ATTEMPTING,
  );
  const notifyConfig = getNotificationConfig(pluginConfig);
  let attempts = 0;
  let delivered = 0;

  for (const state of pending) {
    if (attempts >= maxItems) break;
    const eventKey = state.pipelineNotification?.eventKey;

    if (!eventKey) continue;
    const reserved = await reservePipelineNotification(
      workspaceDir,
      project.slug,
      state.issueId,
      eventKey,
    );

    if (!reserved) continue;
    attempts++;

    try {
      const [issue, endpoint] = await Promise.all([
        provider.getIssue(state.issueId),
        resolveIssueNotificationEndpoint(workspaceDir, project, state.issueId),
      ]);

      if (!endpoint) continue;
      const receipt = await notify({
        type: "pipelineComplete",
        project: project.name,
        issueId: state.issueId,
        issueTitle: issue.title,
        issueUrl: issue.web_url,
        terminalState: state.workflowLabel,
        issueClosed: state.closedAt !== null,
      }, {
        workspaceDir,
        config: notifyConfig,
        channelId: endpoint.channelId,
        channel: endpoint.channel,
        threadId: endpoint.threadId,
        runtime,
        accountId: endpoint.accountId,
        agentId: project.agentId,
        runCommand,
      });

      if (!receipt) continue;
      await confirmPipelineNotification(workspaceDir, project.slug, state.issueId, eventKey);
      delivered++;
    } catch (error) {
      await auditLog(workspaceDir, "pipeline_notification_retry_failed", {
        projectSlug: project.slug,
        issueId: state.issueId,
        eventKey,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => { });
    }
  }

  return delivered;
}
