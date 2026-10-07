/**
 * projection-summary.ts — Shared task output enrichment for local state and provider projection.
 */

import { getStateLabels, ISSUE_INTEGRITY_STATUS, type IssueRuntimeState } from "../../../domain/index.js";
import type { IssueReader } from "../../../integrations/providers/index.js";
import type { Issue } from "../../../integrations/providers/index.js";
import { diffIssueProjection } from "../../../projection/index.js";
import type { ProjectionViewContext, TaskIssueProjectionView, TaskIssueSummary } from "./types.js";

/** Combine provider identity with local assignment and projection differences.
 * @param issue - Provider issue snapshot being summarized.
 * @param ctx - Authoritative snapshot and effective workflow.
 */
export function summarizeTaskIssue(issue: Issue, ctx: ProjectionViewContext): TaskIssueSummary {
  const state = ctx.states[String(issue.iid)];

  return {
    id: issue.iid,
    title: issue.title,
    url: issue.web_url,
    projection: state
      ? summarizeManagedProjection(issue, state, ctx)
      : summarizeUninitializedProjection(issue),
  };
}

/** Read provider observations for local issues and surface lookup failures to callers.
 * @param states - Local records to enrich in deterministic issue order.
 * @param provider - Provider capability or identifier used for this operation.
 * @param projectionCtx - Authoritative snapshot and workflow used for projection comparison.
 */
export async function summarizeLocalIssueStates(
  states: IssueRuntimeState[],
  provider: Pick<IssueReader, "getIssue">,
  projectionCtx: ProjectionViewContext,
): Promise<TaskIssueSummary[]> {
  const result: TaskIssueSummary[] = [];

  for (const state of [...states].sort((a, b) => a.issueId - b.issueId)) {
    const issue = await provider.getIssue(state.issueId);

    result.push(summarizeTaskIssue(issue, projectionCtx));
  }

  return result;
}

/** Compare observed labels with authoritative assignment and expose repair guidance.
 * @param issue - Provider issue snapshot being summarized.
 * @param state - Authoritative local issue record being compared.
 * @param ctx - Authoritative snapshot and effective workflow.
 */
function summarizeManagedProjection(
  issue: Issue,
  state: IssueRuntimeState,
  ctx: ProjectionViewContext,
): TaskIssueProjectionView {
  const diff = diffIssueProjection({
    state,
    actualLabels: issue.labels,
    options: {
      stateLabels: getStateLabels(ctx.workflow),
      roles: ctx.roles,
    },
  });
  const needsRepair = state.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK
    || diff.missingManagedLabels.length > 0
    || diff.unexpectedManagedLabels.length > 0;

  return {
    providerLabels: [...issue.labels].sort(),
    localState: {
      workflowState: state.workflowState,
      workflowLabel: state.workflowLabel,
      assignedRole: state.assignedRole,
      assignedLevel: state.assignedLevel,
    },
    integrityStatus: state.integrityStatus,
    missingManagedLabels: diff.missingManagedLabels,
    unexpectedManagedLabels: diff.unexpectedManagedLabels,
    unmanagedLabels: diff.unmanagedLabels,
    repairHint: needsRepair ? `devclaw issue_repair ${state.issueId} --source local-state --dry-run` : null,
    ...(state.pipelineNotification ? { pipelineNotification: state.pipelineNotification } : {}),
    ...(state.activeWorker?.delivery ? {
      workerDelivery: state.activeWorker.delivery,
      deliveryHint: `Inspect OpenClaw session ${state.activeWorker.sessionKey ?? "unknown"} and the worker slot before retrying issue #${state.issueId}.`
        + " Use devclaw worker-delivery --help with this marker's operationId as --delivery-id to preview and apply a verified conclusion.",
    } : {}),
  };
}

/** Describe provider-only issues without inferring authoritative runtime state.
 * @param issue - Provider issue snapshot being summarized.
 */
function summarizeUninitializedProjection(issue: Issue): TaskIssueProjectionView {
  return {
    providerLabels: [...issue.labels].sort(),
    localState: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.PROJECTION_UNINITIALIZED,
    missingManagedLabels: [],
    unexpectedManagedLabels: [],
    unmanagedLabels: [...issue.labels].sort(),
    repairHint: null,
  };
}
