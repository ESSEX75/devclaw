/**
 * Converts durable creation state into the command's stable caller result.
 */
import { ISSUE_CREATION_STATUS } from "../../../domain/index.js";
import type { IssueCreationOperation } from "../../../state/index.js";
import type { CreatedManagedTask } from "./types.js";

/**
 * Describe readiness and recovery from the persisted operation.
 * An issue with a known provider identity is still unsuccessful until ready.
 *
 * @param operation - Durable operation snapshot shown to the caller.
 */
export function resultFromOperation(operation: IssueCreationOperation): CreatedManagedTask {
  const ready = operation.status === ISSUE_CREATION_STATUS.READY;
  const manual = operation.status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED;
  const failed = operation.status === ISSUE_CREATION_STATUS.CREATION_FAILED && !operation.lastError?.retryable;
  const issue = operation.providerIssue ? {
    iid: operation.providerIssue.issueId,
    title: operation.input.title,
    description: operation.input.body,
    labels: operation.expectedLabels,
    state: "opened",
    web_url: operation.providerIssue.url,
  } : undefined;

  return {
    success: ready,
    status: ready ? "ready" : manual ? "manual_repair_required" : failed ? "failed" : "pending",
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    project: operation.projectSlug,
    issue,
    label: operation.input.workflowLabel,
    workflowState: operation.input.workflowState,
    role: operation.input.assignedRole,
    completedSteps: operation.completedSteps,
    pendingSteps: operation.pendingSteps,
    integrity: ready ? "ok" : manual || failed ? "error" : "pending",
    error: operation.lastError,
    recovery: ready ? undefined : {
      automatic: !manual && operation.lastError?.retryable !== false,
      nextAttemptAt: operation.retryAfter,
      repairHint: operation.providerIssue
        ? `Run issue_repair for provider issue #${operation.providerIssue.issueId} after creation reconciliation stops retrying.`
        : undefined,
    },
    auditCorrelationId: operation.auditCorrelationId,
    announcementSuffix: ready
      ? operation.input.assignedRole
        ? "\nQueued for heartbeat dispatch."
        : "\nWaiting in the initial hold state. Use task_start when the task is ready for dispatch."
      : "\nCreation is pending reconciliation; the issue is not available to heartbeat or workers.",
  };
}
