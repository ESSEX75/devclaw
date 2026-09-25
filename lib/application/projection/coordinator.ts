/** Coordinates issue locking, fresh projection reads, provider changes, and integrity recording. */
import { log as auditLog } from "../../audit.js";
import { getStateLabels, ISSUE_INTEGRITY_STATUS, type WorkflowConfig } from "../../domain/index.js";
import { diffIssueProjection } from "../../projection/index.js";
import { readIssueStateStore, updateIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { applyManagedLabelDiff } from "./apply.js";
import type { ManagedProjectionResult, ReconcileManagedLabelsInput } from "./types.js";

/**
 * Acquire the issue lock before reconciling its provider labels from local truth.
 * @param input - Issue identity, provider capability, and configured projection rules.
 */
export function reconcileManagedLabels(input: ReconcileManagedLabelsInput): Promise<ManagedProjectionResult> {
  return withIssueOrchestrationLock(
    input.workspaceDir,
    input.projectSlug,
    input.issueId,
    () => reconcileManagedLabelsLocked(input),
  );
}

/**
 * Reconcile and verify provider labels while the caller owns the issue lock.
 * A partial mutation or failed verification leaves local integrity in error.
 * @param input - Issue identity, provider capability, and configured projection rules.
 */
export async function reconcileManagedLabelsLocked(
  input: ReconcileManagedLabelsInput,
): Promise<ManagedProjectionResult> {
  const store = await readIssueStateStore(input.workspaceDir, input.projectSlug);
  const state = store.issues[String(input.issueId)];

  if (!state) throw new Error(`Issue #${input.issueId} has no initialized local runtime state.`);

  const stateLabels = getStateLabels(input.workflow);
  const roles = input.roles ?? configuredWorkflowRoles(input.workflow);

  try {
    const issue = await input.provider.getIssue(input.issueId);
    const before = [...issue.labels];
    const diff = diffIssueProjection({ state, actualLabels: before, options: { stateLabels, roles } });

    await applyManagedLabelDiff({ provider: input.provider, diff, workflow: input.workflow, roles, issueId: input.issueId });
    const verified = await input.provider.getIssue(input.issueId);
    const remaining = diffIssueProjection({ state, actualLabels: verified.labels, options: { stateLabels, roles } });

    if (remaining.missingManagedLabels.length > 0 || remaining.unexpectedManagedLabels.length > 0) {
      throw new Error("Managed provider labels still differ after reconciliation.");
    }

    await setProjectionIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
    await auditLog(input.workspaceDir, "issue_projection_reconciled", {
      projectSlug: input.projectSlug,
      issueId: input.issueId,
      owner: input.owner,
      before,
      expected: diff.expectedManagedLabels,
      missingManagedLabels: diff.missingManagedLabels,
      unexpectedManagedLabels: diff.unexpectedManagedLabels,
    });

    return {
      issueId: input.issueId,
      before,
      diff,
      changed: diff.missingManagedLabels.length > 0 || diff.unexpectedManagedLabels.length > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await setProjectionIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, [
      `managed projection failed for ${input.owner}: ${message}`,
    ]);
    throw error;
  }
}

/**
 * Collect roles referenced by configured workflow states when no explicit list is supplied.
 * @param workflow - Resolved workflow whose state roles define the label set.
 */
function configuredWorkflowRoles(workflow: WorkflowConfig): string[] {
  const roles = new Set<string>();

  for (const state of Object.values(workflow.states)) {
    if (state.role) roles.add(state.role);
  }

  return [...roles];
}

/**
 * Persist integrity status after provider reconciliation or failure.
 * @param input - Active issue location and identity.
 * @param status - Verified projection status to persist.
 * @param errors - Diagnostic messages retained for repair.
 */
async function setProjectionIntegrity(
  input: Pick<ReconcileManagedLabelsInput, "workspaceDir" | "projectSlug" | "issueId">,
  status: typeof ISSUE_INTEGRITY_STATUS.OK | typeof ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
  errors: string[],
): Promise<void> {
  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) return { store, result: undefined };
    const updated = { ...state, integrityStatus: status, integrityErrors: errors, updatedAt: new Date().toISOString() };

    return { store: { ...store, issues: { ...store.issues, [String(input.issueId)]: updated } }, result: undefined };
  });
}
