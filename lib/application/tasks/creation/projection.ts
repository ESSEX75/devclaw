/**
 * Applies and verifies the provider-visible projection of a created issue.
 */
import { ISSUE_CREATION_ERROR, ISSUE_CREATION_STATUS } from "../../../domain/index.js";
import {
  diffIssueProjection,
  extractIssueCreationMarker,
  extractIssueMetadata,
  metadataMatches,
  renderIssueCreationMarker,
  replaceIssueMetadata,
} from "../../../projection/index.js";
import type { IssueCreationOperation } from "../../../state/index.js";
import { buildInitialIssueRuntimeState } from "../../issue-runtime/index.js";
import { applyManagedLabelDiff } from "../../projection/index.js";
import { CREATION_STEPS } from "./const.js";
import { IssueCreationFailureError } from "./failure.js";
import { completeStep, transitionStatus, updateOperation } from "./record.js";
import type { CreateManagedTaskInput } from "./types.js";

/**
 * Apply managed labels and metadata, then verify provider read-back.
 * Runtime state remains unpublished until this operation persists verification.
 *
 * @param opts - Provider and resolved workflow used for projection.
 * @param operation - Durable operation with a known provider identity.
 */
export async function reconcileCreatedProviderIssue(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
): Promise<IssueCreationOperation> {
  const providerRef = operation.providerIssue;

  if (!providerRef) throw new Error("Provider identity is missing from provider_created operation.");
  let issue = await opts.provider.getIssue(providerRef.issueId);
  const draft = buildInitialIssueRuntimeState(operation.input, operation.projectSlug, issue.iid);
  const diff = diffIssueProjection({
    state: draft,
    actualLabels: issue.labels,
    options: { stateLabels: Object.values(opts.workflow.states).map((state) => state.label), roles: opts.roles },
  });

  await applyManagedLabelDiff({ issueId: issue.iid, provider: opts.provider, diff, workflow: opts.workflow, roles: opts.roles ?? [] });
  const metadata = { projectSlug: operation.projectSlug, issueId: issue.iid, projectionVersion: 1 };

  if (!metadataMatches(extractIssueMetadata(issue.description), metadata)) {
    await opts.provider.editIssue(issue.iid, { body: replaceIssueMetadata(issue.description, metadata) });
  }

  issue = await opts.provider.getIssue(issue.iid);
  const verifiedDiff = diffIssueProjection({
    state: draft,
    actualLabels: issue.labels,
    options: { stateLabels: Object.values(opts.workflow.states).map((state) => state.label), roles: opts.roles },
  });
  const verifiedMetadata = metadataMatches(extractIssueMetadata(issue.description), metadata);
  const markerMatches = extractIssueCreationMarker(issue.description) === operation.operationId;
  const bodyMatches = operation.input.body.trim() === ""
    || (issue.description ?? "").includes(operation.input.body.trim());

  if (
    issue.title !== operation.input.title
    || !bodyMatches
    || verifiedDiff.missingManagedLabels.length > 0
    || verifiedDiff.unexpectedManagedLabels.length > 0
    || !verifiedMetadata
    || !markerMatches
  ) {
    throw new IssueCreationFailureError({
      code: ISSUE_CREATION_ERROR.PROJECTION_VERIFICATION_FAILED,
      message: "Provider read-back does not match the expected creation projection.",
      retryable: true,
    });
  }

  return updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED);
    completeStep(target, CREATION_STEPS.PROJECTION_VERIFIED);
    target.lastError = undefined;
    target.retryAfter = undefined;
  });
}

/**
 * Bind the provider issue body to its durable creation operation.
 *
 * @param body - Requested issue description.
 * @param operationId - Durable operation identity embedded in the marker.
 */
export function appendCreationMarker(body: string, operationId: string): string {
  const marker = renderIssueCreationMarker(operationId);

  return body.trim() ? `${body.trimEnd()}\n\n${marker}` : marker;
}
