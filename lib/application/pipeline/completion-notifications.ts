/** Builds completion events from committed state and records terminal delivery evidence. */

import { log as auditLog } from "../../audit.js";
import {
  ACTION, COMPLETION_RESULT, DEFAULT_ROLES, DEFAULT_WORKFLOW, findStateByLabel, ISSUE_INTEGRITY_STATUS, NOTIFICATION_CHANNEL, REVIEW_POLICY, STATE_TYPE,
} from "../../domain/index.js";
import { reservePipelineNotification } from "../../state/index.js";
import { NOTIFICATION_BLOCKED } from "../notifications/const.js";
import {
  getNotificationConfig,
  NOTIFICATION_EVENT,
  notify,
  type NotifyEvent,
  type NotifyOptions,
  recordPipelineNotificationOutcome,
  resolveIssueNotificationEndpoint,
} from "../notifications/index.js";
import { PIPELINE_AUDIT } from "./const.js";
import type { CompletionNotificationInput } from "./types.js";

/** Notify after the local commit and worker release; terminal uncertainty remains durable.
 * @param input - Committed completion and provider context.
 */
export async function notifyCompletion(input: CompletionNotificationInput): Promise<void> {
  const { opts, project, issue, runtimeState, plan, actions, workerName } = input;
  const { workspaceDir, projectSlug, issueId, role, result, summary, projectName, pluginConfig, runtime, createdTasks, workflow = DEFAULT_WORKFLOW, runCommand } = opts;
  const { rule, nextState } = plan;
  const { prUrl, mergedPr, prTitle, sourceBranch } = actions;

  if (runtimeState.pendingWorkerRelease || runtimeState.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK) return;
  const target = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);
  const config = getNotificationConfig(pluginConfig);
  const delivery: NotifyOptions = {
    workspaceDir, config, channelId: target?.channelId, channel: target?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
    threadId: target?.threadId, runtime, runCommand, accountId: target?.accountId, agentId: project.agentId,
  };
  const context = { project: projectName, issueId, issueUrl: issue.web_url };

  if (input.notifyAuxiliary) sendBestEffort({ ...context, type: NOTIFICATION_EVENT.WORKER_COMPLETE, role, level: opts.level,
    name: workerName, result, summary, nextState, prUrl, createdTasks }, delivery);
  if (input.notifyAuxiliary && mergedPr) sendBestEffort({ ...context, type: NOTIFICATION_EVENT.PR_MERGED, issueTitle: issue.title,
    prUrl, prTitle, sourceBranch, targetBranch: project.baseBranch, mergedBy: "pipeline" }, delivery);

  if (findStateByLabel(workflow, rule.to)?.type === STATE_TYPE.TERMINAL) {
    const eventKey = runtimeState.pipelineNotification?.eventKey;

    if (!eventKey) throw new Error(`Terminal issue #${issueId} has no committed notification intent.`);
    const token = await reservePipelineNotification(workspaceDir, projectSlug, issueId, eventKey);

    if (token) {
      if (!target || config[NOTIFICATION_EVENT.PIPELINE_COMPLETE] === false) {
        await recordPipelineNotificationOutcome(workspaceDir, projectSlug, issueId, eventKey, token, {
          status: NOTIFICATION_BLOCKED, delivered: false,
          reason: !target ? "Stored notification endpoint is missing; restore the exact binding." : "Notification event is disabled.",
        });
      } else {
        const outcome = await notify({ ...context, type: NOTIFICATION_EVENT.PIPELINE_COMPLETE, issueTitle: issue.title,
          terminalState: rule.to, pullRequestUrl: prUrl, mergeResult: mergedPr ? "merged" : undefined,
          testResult: role === DEFAULT_ROLES.TESTER ? result : undefined, issueClosed: rule.actions.includes(ACTION.CLOSE_ISSUE),
        }, delivery);

        await recordPipelineNotificationOutcome(workspaceDir, projectSlug, issueId, eventKey, token, outcome);
      }
    }
  }

  const routing = runtimeState.reviewPolicy;

  if (input.notifyAuxiliary && role === DEFAULT_ROLES.DEVELOPER && result === COMPLETION_RESULT.DONE
    && (routing === REVIEW_POLICY.HUMAN || routing === REVIEW_POLICY.AGENT)) {
    sendBestEffort({ ...context, type: NOTIFICATION_EVENT.REVIEW_NEEDED, issueTitle: issue.title, routing, prUrl }, delivery);
  }
}

/** Send an auxiliary event whose failure must not invalidate a committed transition.
 * @param event - Non-durable informational notification.
 * @param options - Exact route and transport capabilities.
 */
function sendBestEffort(event: NotifyEvent, options: NotifyOptions): void {
  void notify(event, options).catch((error: unknown) => {
    void auditLog(options.workspaceDir, PIPELINE_AUDIT.WARNING, {
      step: event.type, error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
  });
}
