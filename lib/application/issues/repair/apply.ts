/**
 * Executes local-source and provider-source repair under the caller's issue lock.
 */
import type { IssueIntegrityStatus } from "../../../domain/index.js";
import type { ProviderRateLimitStatus } from "../../../integrations/providers/index.js";
import { replaceIssueMetadata } from "../../../projection/index.js";
import { updateIssueStateStore } from "../../../state/index.js";
import { applyManagedLabelDiff } from "../../projection/index.js";
import { ISSUE_REPAIR_ERROR, REPAIR_ACTION, REPAIR_METADATA_ACTION } from "./const.js";
import { repairFailure } from "./failure.js";
import { expectedMetadataFor, importProviderProjection } from "./plan.js";
import type { IssueRepairResult, RepairContext, RepairManagedIssueInput, RepairProvider } from "./types.js";

/** Apply local truth to provider labels and metadata.
 * @param input - Validated command input and runtime dependencies.
 * @param context - Fresh local/provider snapshots and resolved project configuration.
 * @param plan - Snapshot-bound repair plan whose outcome is being updated.
 */
export async function applyLocalSourceRepair(
  input: RepairManagedIssueInput,
  context: RepairContext,
  plan: IssueRepairResult,
): Promise<string[]> {
  await applyManagedLabelDiff({
    issueId: input.issueId,
    provider: context.provider,
    diff: plan.diffBefore,
    workflow: context.workflow,
    roles: Object.keys(context.roles),
  });
  const actions = plan.plannedActions.filter((action) => action !== REPAIR_ACTION.VERIFY_PROVIDER_PROJECTION);

  if (plan.metadataAction === REPAIR_METADATA_ACTION.REPLACE) {
    await context.provider.editIssue(input.issueId, {
      body: replaceIssueMetadata(context.providerIssue.description, expectedMetadataFor(context.local)),
    });
  }

  return actions;
}

/** Apply explicitly imported provider fields to local truth.
 * @param input - Validated command input and runtime dependencies.
 * @param context - Fresh local/provider snapshots and resolved project configuration.
 * @param plan - Snapshot-bound repair plan whose outcome is being updated.
 */
export async function applyProviderSourceRepair(
  input: RepairManagedIssueInput,
  context: RepairContext,
  plan: IssueRepairResult,
): Promise<string[]> {
  const imported = importProviderProjection(context);

  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) throw repairFailure(ISSUE_REPAIR_ERROR.LOCAL_STATE_NOT_FOUND, "Local state disappeared during repair.");
    let updated = { ...state };

    for (const change of plan.localChanges) {
      if (change.field === "workflowState") updated = { ...updated, workflowState: imported.workflowState };
      else if (change.field === "workflowLabel") updated = { ...updated, workflowLabel: imported.workflowLabel };
      else if (change.field === "assignedRole") updated = { ...updated, assignedRole: imported.assignedRole };
      else if (change.field === "assignedLevel") updated = { ...updated, assignedLevel: imported.assignedLevel };
      else if (change.field === "owner") updated = { ...updated, owner: imported.owner };
      else if (change.field === "reviewPolicy") updated = { ...updated, reviewPolicy: imported.reviewPolicy };
      else if (change.field === "testPolicy") updated = { ...updated, testPolicy: imported.testPolicy };
      else updated = { ...updated, notifyTarget: imported.notifyTarget };
    }

    updated.updatedAt = new Date().toISOString();

    return { store: { ...store, issues: { ...store.issues, [String(input.issueId)]: updated } }, result: undefined };
  });

  return plan.localChanges.length ? [REPAIR_ACTION.UPDATE_ALLOWED_LOCAL_FIELDS] : [];
}

/** Read optional provider quota without blocking providers lacking it.
 * @param provider - Provider adapter used for quota reads or issue operations.
 */
export async function readRateLimit(provider: RepairProvider): Promise<ProviderRateLimitStatus | undefined> {
  try {
    return await provider.getRateLimitStatus?.();
  } catch {
    return undefined;
  }
}

/** Persist post-apply integrity status.
 * @param input - Validated command input and runtime dependencies.
 * @param status - Resulting integrity classification to persist.
 * @param errors - Concrete integrity diagnostics retained for recovery.
 */
export async function setRepairIntegrity(input: RepairManagedIssueInput, status: IssueIntegrityStatus, errors: string[]): Promise<void> {
  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) return { store, result: undefined };
    const updated = { ...state, integrityStatus: status, integrityErrors: errors, updatedAt: new Date().toISOString() };

    return { store: { ...store, issues: { ...store.issues, [String(input.issueId)]: updated } }, result: undefined };
  });
}
