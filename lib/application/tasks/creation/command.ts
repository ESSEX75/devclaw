/**
 * Opens or resumes one managed task creation under its idempotency lock.
 */
import { createHash } from "node:crypto";

import { ISSUE_CREATION_ERROR, ISSUE_CREATION_STATUS, REVIEW_POLICY, STATE_TYPE, TEST_POLICY, type WorkflowConfig } from "../../../domain/index.js";
import { expectedManagedLabels } from "../../../projection/index.js";
import type { IssueCreationOperation } from "../../../state/index.js";
import { newIssueCreationIdentity, updateIssueCreationStore, withIssueCreationLock } from "../../../state/index.js";
import { buildInitialIssueRuntimeState } from "../../issue-runtime/index.js";
import { creationAudit } from "./audit.js";
import { CREATION_STEPS } from "./const.js";
import { IssueCreationFailureError } from "./failure.js";
import { withCreationPermit } from "./permit.js";
import { runCreationOperation } from "./runner.js";
import type { CreatedManagedTask, CreateManagedTaskInput } from "./types.js";

/**
 * Create or resume one issue creation operation under its idempotency lock.
 * A repeated key with a different payload fails before any provider mutation.
 *
 * @param opts - Validated creation request and provider capability.
 */
export function createManagedTaskIssue(opts: CreateManagedTaskInput): Promise<CreatedManagedTask> {
  return withIssueCreationLock(opts.workspaceDir, opts.project.slug, opts.idempotencyKey, async () => {
    const operation = await ensureCreationOperation(opts);

    await creationAudit(opts, operation, "issue_creation_requested");

    return withCreationPermit(`${opts.providerType}:${opts.project.slug}`, () => runCreationOperation(opts, operation, false));
  });
}

/**
 * Bind the idempotency key to its immutable creation payload.
 * Reject a conflicting payload before any provider mutation.
 *
 * @param opts - Request whose payload is bound to the durable operation.
 */
async function ensureCreationOperation(opts: CreateManagedTaskInput): Promise<IssueCreationOperation> {
  const workflowState = opts.workflowState ?? opts.workflow.initial;
  const initialState = requireCreationState(opts.workflow, workflowState);
  const input = {
    title: opts.title,
    body: opts.description,
    assignees: opts.assignees ?? [],
    workflowState,
    workflowLabel: initialState.label,
    assignedRole: opts.assignedRole !== undefined
      ? opts.assignedRole
      : initialState.type === STATE_TYPE.QUEUE ? initialState.role : null,
    assignedLevel: opts.assignedLevel ?? null,
    owner: opts.owner ?? null,
    reviewPolicy: opts.workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN,
    testPolicy: opts.workflow.testPolicy ?? TEST_POLICY.SKIP,
    notifyTarget: opts.notifyTarget ?? null,
    provider: opts.providerType,
  };
  const draft = buildInitialIssueRuntimeState(input, opts.project.slug, 1);
  const expectedLabels = expectedManagedLabels(draft);
  const payloadHash = hashPayload({ projectSlug: opts.project.slug, input, expectedLabels });

  return updateIssueCreationStore(opts.workspaceDir, opts.project.slug, (store) => {
    const existing = store.operations[opts.idempotencyKey];

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IssueCreationFailureError({
          code: ISSUE_CREATION_ERROR.IDEMPOTENCY_CONFLICT,
          message: "Idempotency key is already bound to a different creation payload.",
          retryable: false,
        });
      }

      return { store, result: existing };
    }

    const now = new Date().toISOString();
    const identity = newIssueCreationIdentity();
    const operation: IssueCreationOperation = {
      ...identity,
      idempotencyKey: opts.idempotencyKey,
      payloadHash,
      projectSlug: opts.project.slug,
      requestedBy: opts.requestedBy,
      requestedAt: now,
      updatedAt: now,
      status: ISSUE_CREATION_STATUS.CREATING,
      input,
      expectedLabels,
      completedSteps: [],
      pendingSteps: [
        CREATION_STEPS.PREFLIGHT,
        CREATION_STEPS.PROVIDER_STARTED,
        CREATION_STEPS.PROVIDER_CREATED,
        CREATION_STEPS.PROJECTION_VERIFIED,
        CREATION_STEPS.LOCAL_COMMITTED,
        CREATION_STEPS.READY,
      ],
      attempts: 0,
    };

    return {
      store: { ...store, operations: { ...store.operations, [opts.idempotencyKey]: operation } },
      result: operation,
    };
  });
}

/**
 * Require a configured hold or queue state for initial creation.
 *
 * @param workflow - Resolved workflow defining valid states.
 * @param workflowState - Requested initial state key.
 */
function requireCreationState(workflow: WorkflowConfig, workflowState: string) {
  const initialState = workflow.states[workflowState];

  if (!initialState) throw new Error(`Creation workflow state "${workflowState}" not found.`);
  if (initialState.type !== STATE_TYPE.HOLD && initialState.type !== STATE_TYPE.QUEUE) {
    throw new Error(`Creation workflow state "${workflowState}" must be hold or queue.`);
  }

  return initialState;
}

/**
 * Hash the canonical request payload for idempotency comparison.
 *
 * @param value - Canonical data bound to the caller's key.
 */
function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
