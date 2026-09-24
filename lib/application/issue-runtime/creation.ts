/**
 * Builds a complete initial runtime record for projection before publication.
 */
import { ISSUE_INTEGRITY_STATUS, type IssueRuntimeState } from "../../domain/index.js";
import type { InitialIssueRuntimeInput } from "./types.js";

/**
 * Build the complete draft runtime state for a created provider issue.
 * The caller must verify provider read-back before persisting this record.
 *
 * @param input - Durable, validated creation input.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Provider-local issue identity.
 */
export function buildInitialIssueRuntimeState(
  input: InitialIssueRuntimeInput,
  projectSlug: string,
  issueId: number,
): IssueRuntimeState {
  const now = new Date().toISOString();

  return {
    projectSlug,
    issueId,
    provider: input.provider,
    workflowState: input.workflowState,
    workflowLabel: input.workflowLabel,
    assignedRole: input.assignedRole,
    assignedLevel: input.assignedLevel,
    owner: input.owner,
    reviewPolicy: input.reviewPolicy,
    testPolicy: input.testPolicy,
    notifyTarget: input.notifyTarget,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    providerMissing: null,
    pipelineNotification: null,
  };
}
