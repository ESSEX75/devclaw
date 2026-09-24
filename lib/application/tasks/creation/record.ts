/**
 * Persists creation checkpoints and validates durable status transitions.
 */
import { ISSUE_CREATION_STATUS, type IssueCreationStatus } from "../../../domain/index.js";
import type { IssueCreationFailure, IssueCreationOperation } from "../../../state/index.js";
import { updateIssueCreationStore } from "../../../state/index.js";
import { creationAudit } from "./audit.js";
import type { CreateManagedTaskInput } from "./types.js";

/**
 * Persist completion of one saga checkpoint.
 *
 * @param opts - Workspace and project owning the operation.
 * @param operation - Current durable snapshot.
 * @param step - Checkpoint marked complete.
 * @param status - Status persisted with the checkpoint.
 * @param incrementAttempt - Whether provider mutation began at this checkpoint.
 */
export async function markStep(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  step: string,
  status: IssueCreationStatus,
  incrementAttempt = false,
): Promise<IssueCreationOperation> {
  return updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, status);
    completeStep(target, step);
    if (incrementAttempt) target.attempts += 1;
  });
}

/**
 * Persist a failure without discarding completed checkpoints.
 *
 * @param opts - Workspace and project owning the operation.
 * @param operation - Current durable snapshot.
 * @param status - Failure status allowed from the current state.
 * @param failure - Typed failure and retry policy.
 */
export async function failOperation(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  status: IssueCreationStatus,
  failure: IssueCreationFailure,
): Promise<IssueCreationOperation> {
  const updated = await updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, status);
    target.lastError = failure;
    target.retryAfter = failure.retryAfter;
  });

  await creationAudit(opts, updated, status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED
    ? "issue_creation_manual_repair_required"
    : "issue_creation_failed");

  return updated;
}

/**
 * Atomically update one durable creation operation.
 *
 * @param opts - Workspace and project owning the creation store.
 * @param idempotencyKey - Key locating the operation.
 * @param update - Mutation applied to a cloned operation under the store lock.
 */
export async function updateOperation(
  opts: Pick<CreateManagedTaskInput, "workspaceDir" | "project">,
  idempotencyKey: string,
  update: (operation: IssueCreationOperation) => void,
): Promise<IssueCreationOperation> {
  return updateIssueCreationStore(opts.workspaceDir, opts.project.slug, (store) => {
    const persisted = store.operations[idempotencyKey];

    if (!persisted) throw new Error(`Issue creation operation "${idempotencyKey}" disappeared.`);
    const operation = structuredClone(persisted);

    update(operation);
    operation.updatedAt = new Date().toISOString();

    return {
      store: { ...store, operations: { ...store.operations, [idempotencyKey]: operation } },
      result: operation,
    };
  });
}

/**
 * Reject invalid durable state transitions.
 *
 * @param operation - Operation whose status is advanced.
 * @param next - Proposed durable status.
 */
export function transitionStatus(operation: IssueCreationOperation, next: IssueCreationStatus): void {
  const allowed: Record<IssueCreationStatus, readonly IssueCreationStatus[]> = {
    [ISSUE_CREATION_STATUS.CREATING]: [
      ISSUE_CREATION_STATUS.CREATING,
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
      ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED,
    ],
    [ISSUE_CREATION_STATUS.PROVIDER_CREATED]: [
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.PROJECTION_VERIFIED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
    ],
    [ISSUE_CREATION_STATUS.PROJECTION_VERIFIED]: [
      ISSUE_CREATION_STATUS.PROJECTION_VERIFIED,
      ISSUE_CREATION_STATUS.READY,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
    ],
    [ISSUE_CREATION_STATUS.READY]: [ISSUE_CREATION_STATUS.READY],
    [ISSUE_CREATION_STATUS.CREATION_FAILED]: [
      ISSUE_CREATION_STATUS.CREATING,
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
      ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED,
    ],
    [ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED]: [ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED],
  };

  if (!allowed[operation.status].includes(next)) {
    throw new Error(`Invalid issue creation transition ${operation.status} -> ${next}.`);
  }

  operation.status = next;
}

/**
 * Move one step from pending to completed once.
 *
 * @param operation - Operation whose checkpoints are updated.
 * @param step - Durable checkpoint being completed.
 */
export function completeStep(operation: IssueCreationOperation, step: string): void {
  if (!operation.completedSteps.includes(step)) operation.completedSteps.push(step);
  operation.pendingSteps = operation.pendingSteps.filter((candidate) => candidate !== step);
}
