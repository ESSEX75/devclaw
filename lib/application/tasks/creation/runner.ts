/**
 * Advances a durable creation operation through provider and local-state phases.
 */
import { ISSUE_CREATION_ERROR, ISSUE_CREATION_STATUS, ISSUE_INTEGRITY_STATUS } from "../../../domain/index.js";
import type { IssueCreationOperation } from "../../../state/index.js";
import { writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { creationAudit } from "./audit.js";
import { CREATION_STEPS } from "./const.js";
import { creationFailureFromProvider, IssueCreationFailureError } from "./failure.js";
import { appendCreationMarker, reconcileCreatedProviderIssue } from "./projection.js";
import { completeStep, failOperation, markStep, transitionStatus, updateOperation } from "./record.js";
import { resultFromOperation } from "./result.js";
import type { CreatedManagedTask, CreateManagedTaskInput, CreationProvider } from "./types.js";

/**
 * Advance an operation from its last persisted checkpoint.
 * A started provider mutation with no known identity requires manual repair.
 *
 * @param opts - Current provider and project dependencies.
 * @param operation - Last durable operation snapshot.
 * @param recovering - Whether heartbeat initiated this attempt.
 */
export async function runCreationOperation(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  recovering: boolean,
): Promise<CreatedManagedTask> {
  let current = operation;

  if (current.status === ISSUE_CREATION_STATUS.READY) return resultFromOperation(current);
  if (current.status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED) return resultFromOperation(current);
  if (current.status === ISSUE_CREATION_STATUS.CREATION_FAILED && current.lastError?.retryable === false) {
    return resultFromOperation(current);
  }

  if (current.retryAfter && Date.parse(current.retryAfter) > Date.now()) return resultFromOperation(current);

  if (!current.providerIssue) {
    if (
      current.status === ISSUE_CREATION_STATUS.CREATION_FAILED
      && current.lastError?.retryable
      && (
        current.lastError.code === ISSUE_CREATION_ERROR.PROVIDER_CREATE_FAILED
        || current.lastError.code === ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED
      )
    ) {
      current = await updateOperation(opts, current.idempotencyKey, (target) => {
        transitionStatus(target, ISSUE_CREATION_STATUS.CREATING);
        target.completedSteps = target.completedSteps.filter((step) => step !== CREATION_STEPS.PROVIDER_STARTED);
        if (!target.pendingSteps.includes(CREATION_STEPS.PROVIDER_STARTED)) {
          target.pendingSteps.push(CREATION_STEPS.PROVIDER_STARTED);
        }
      });
    }

    if (current.completedSteps.includes(CREATION_STEPS.PROVIDER_STARTED)) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED, {
        code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN,
        message: "Provider create began but its outcome was not durably recorded.",
        retryable: false,
      });

      return resultFromOperation(current);
    }

    const quota = await safeRateLimit(opts.provider);
    const estimatedRequests = 4;

    if (quota && quota.remaining < estimatedRequests) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.CREATION_FAILED, {
        code: ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED,
        message: "Provider quota is below the conservative creation request budget.",
        retryable: true,
        retryAfter: quota.resetAt ?? new Date(Date.now() + 60_000).toISOString(),
      });

      return resultFromOperation(current);
    }

    current = await markStep(opts, current, CREATION_STEPS.PREFLIGHT, ISSUE_CREATION_STATUS.CREATING);
    await creationAudit(opts, current, "issue_creation_preflight_completed");
    current = await markStep(opts, current, CREATION_STEPS.PROVIDER_STARTED, ISSUE_CREATION_STATUS.CREATING, true);
    await creationAudit(opts, current, "issue_creation_provider_started");

    let providerIssue;

    try {
      providerIssue = await opts.provider.createIssue({
        title: current.input.title,
        body: appendCreationMarker(current.input.body, current.operationId),
        labels: current.expectedLabels,
        assignees: current.input.assignees,
      });
    } catch (error) {
      const failure = creationFailureFromProvider(error);
      const status = failure.code === ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN
        ? ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED
        : ISSUE_CREATION_STATUS.CREATION_FAILED;

      current = await failOperation(opts, current, status, failure);

      return resultFromOperation(current);
    }

    try {
      current = await updateOperation(opts, current.idempotencyKey, (target) => {
        transitionStatus(target, ISSUE_CREATION_STATUS.PROVIDER_CREATED);
        target.providerIssue = { issueId: providerIssue.iid, url: providerIssue.web_url, createdAt: new Date().toISOString() };
        completeStep(target, CREATION_STEPS.PROVIDER_CREATED);
        target.lastError = undefined;
        target.retryAfter = undefined;
      });
    } catch (error) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED, {
        code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });

      return resultFromOperation(current);
    }

    await creationAudit(opts, current, "issue_creation_provider_created");
  }

  if (current.status === ISSUE_CREATION_STATUS.CREATION_FAILED && current.providerIssue) {
    current = await updateOperation(opts, current.idempotencyKey, (target) => transitionStatus(target, ISSUE_CREATION_STATUS.PROVIDER_CREATED));
  }

  if (current.status === ISSUE_CREATION_STATUS.PROVIDER_CREATED && current.providerIssue) {
    await creationAudit(opts, current, "issue_creation_projection_started");

    try {
      current = await reconcileCreatedProviderIssue(opts, current);
    } catch (error) {
      const failure = error instanceof IssueCreationFailureError
        ? error.failure
        : {
          code: ISSUE_CREATION_ERROR.PROJECTION_APPLY_FAILED,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };

      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.PROVIDER_CREATED, failure);

      return resultFromOperation(current);
    }

    await creationAudit(opts, current, "issue_creation_projection_verified");
  }

  if (current.status === ISSUE_CREATION_STATUS.PROJECTION_VERIFIED && current.providerIssue) {
    try {
      const providerIssue = await opts.provider.getIssue(current.providerIssue.issueId);

      await writeIssueRuntimeState({
        workspaceDir: opts.workspaceDir,
        project: opts.project,
        issue: providerIssue,
        providerType: current.input.provider,
        creationOperationId: current.operationId,
        workflow: opts.workflow,
        workflowLabel: current.input.workflowLabel,
        workflowState: current.input.workflowState,
        assignedRole: current.input.assignedRole,
        assignedLevel: current.input.assignedLevel,
        owner: current.input.owner,
        notifyTarget: current.input.notifyTarget,
        reviewPolicy: current.input.reviewPolicy,
        testPolicy: current.input.testPolicy,
        integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
      });
      current = await markStep(opts, current, CREATION_STEPS.LOCAL_COMMITTED, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED);
    } catch (error) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED, {
        code: ISSUE_CREATION_ERROR.LOCAL_COMMIT_FAILED,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });

      return resultFromOperation(current);
    }

    await creationAudit(opts, current, "issue_creation_local_state_committed");

    try {
      current = await markStep(opts, current, CREATION_STEPS.READY, ISSUE_CREATION_STATUS.READY);
    } catch (error) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED, {
        code: ISSUE_CREATION_ERROR.LOCAL_COMMIT_FAILED,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });

      return resultFromOperation(current);
    }

    await creationAudit(opts, current, recovering ? "issue_creation_reconciled" : "issue_creation_ready");
  }

  return resultFromOperation(current);
}

/**
 * Read the optional provider quota without blocking providers that lack it.
 *
 * @param provider - Adapter offering an optional quota snapshot.
 */
async function safeRateLimit(provider: CreationProvider) {
  try {
    return await provider.getRateLimitStatus?.();
  } catch {
    return undefined;
  }
}
