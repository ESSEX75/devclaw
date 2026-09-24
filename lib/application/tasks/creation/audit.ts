/**
 * Records creation saga checkpoints with their durable operation identity.
 */
import { log as auditLog } from "../../../audit.js";
import type { IssueCreationOperation } from "../../../state/index.js";
import type { CreateManagedTaskInput } from "./types.js";

/**
 * Audit the operation state after a durable checkpoint.
 *
 * @param opts - Workspace containing the audit log.
 * @param operation - Durable snapshot whose checkpoint is recorded.
 * @param event - Stable creation event identifier.
 */
export async function creationAudit(opts: CreateManagedTaskInput, operation: IssueCreationOperation, event: string): Promise<void> {
  await auditLog(opts.workspaceDir, event, {
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    correlationId: operation.auditCorrelationId,
    projectSlug: operation.projectSlug,
    requestedBy: operation.requestedBy,
    status: operation.status,
    providerIssueId: operation.providerIssue?.issueId,
    completedSteps: operation.completedSteps,
    pendingSteps: operation.pendingSteps,
    error: operation.lastError,
  });
}
