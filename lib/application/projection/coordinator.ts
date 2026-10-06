/** Coordinates issue locking, fresh projection reads, provider changes, and integrity recording. */

import { log as auditLog } from "../../audit.js";
import { getStateLabels, ISSUE_INTEGRITY_STATUS, type IssueProjectionState, UNVERIFIED_INTEGRITY_ERROR, type WorkflowConfig } from "../../domain/index.js";
import { diffIssueProjection } from "../../projection/index.js";
import { readIssueStateStore, updateIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { applyManagedLabelDiff } from "./apply.js";
import { PROJECTION_EVENT, PROJECTION_FAILURE_PREFIX } from "./const.js";
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
 * A partial mutation or failed verification adds a label-owned error. Success clears
 * only label-owned diagnostics; metadata and other failures require their own verification.
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

  let result: Omit<ManagedProjectionResult, "integrity" | "auditError">;

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

    result = {
      issueId: input.issueId,
      before,
      diff,
      changed: diff.missingManagedLabels.length > 0 || diff.unexpectedManagedLabels.length > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await setProjectionIntegrity(input, `${PROJECTION_FAILURE_PREFIX}${input.owner}: ${message}`);
    throw error;
  }

  // A persistence failure is not evidence of a provider mismatch; audit has its own outcome.
  const integrity = await setProjectionIntegrity(input);
  let auditError: string | undefined;

  try {
    await auditLog(input.workspaceDir, PROJECTION_EVENT.RECONCILED, {
      projectSlug: input.projectSlug,
      issueId: input.issueId,
      owner: input.owner,
      before: result.before,
      expected: result.diff.expectedManagedLabels,
      missingManagedLabels: result.diff.missingManagedLabels,
      unexpectedManagedLabels: result.diff.unexpectedManagedLabels,
      integrityStatus: integrity.integrityStatus,
      integrityErrors: integrity.integrityErrors,
    });
  } catch (error) {
    auditError = error instanceof Error ? error.message : String(error);
  }

  return { ...result, integrity, ...(auditError ? { auditError } : {}) };
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
 * Replace only errors owned by label reconciliation using the latest local record.
 * Unknown failures and non-OK states without diagnostic ownership remain blocked.
 * @param input - Active issue location and identity.
 * @param failure - Label failure to record; omission means labels were verified.
 */
async function setProjectionIntegrity(
  input: Pick<ReconcileManagedLabelsInput, "workspaceDir" | "projectSlug" | "issueId">,
  failure?: string,
): Promise<IssueProjectionState> {
  return updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) throw new Error(`Issue #${input.issueId} disappeared during projection reconciliation.`);
    const otherErrors = state.integrityErrors.filter(message => !message.startsWith(PROJECTION_FAILURE_PREFIX));
    const ownedErrors = state.integrityErrors.length !== otherErrors.length;

    if (failure && state.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK && state.integrityErrors.length === 0) {
      otherErrors.push(UNVERIFIED_INTEGRITY_ERROR);
    }

    const integrityErrors = failure ? [...otherErrors, failure] : otherErrors;
    const integrityStatus = failure || otherErrors.length > 0
      ? ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
      : ownedErrors ? ISSUE_INTEGRITY_STATUS.OK : state.integrityStatus;
    const integrity = { integrityStatus, integrityErrors };
    const updated = { ...state, ...integrity, updatedAt: new Date().toISOString() };

    return { store: { ...store, issues: { ...store.issues, [String(input.issueId)]: updated } }, result: integrity };
  });
}
