/** Builds read-only task views from authoritative local state and provider observations. */

import { ISSUE_CREATION_STATUS, STATE_TYPE, type WorkflowConfig } from "../../../domain/index.js";
import type { IssueReader } from "../../../integrations/providers/index.js";
import {
  isIssueCreationReady,
  readIssueCreationStore,
  readIssueStateStore
} from "../../../state/index.js";
import { summarizeLocalIssueStates } from "./projection-summary.js";
import type { GetManagedTaskStatusInput, ProjectionViewContext, TaskStatusResult } from "./types.js";

/** Summarize ready open tasks separately from unfinished creation operations.
 * @param opts - Resolved project dependencies and operation-specific input.
 */
export async function getManagedTaskStatus(opts: GetManagedTaskStatusInput): Promise<TaskStatusResult> {
  const statesByType = getWorkflowStateLabelsByType(opts.workflow);
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const projectionCtx: ProjectionViewContext = { states: store.issues, workflow: opts.workflow, roles: opts.roles };
  const openLocalStates = [];

  for (const state of Object.values(store.issues)) {
    if (state.closedAt == null && await isIssueCreationReady(opts.workspaceDir, opts.projectSlug, state.creationOperationId)) {
      openLocalStates.push(state);
    }
  }

  const creationStore = await readIssueCreationStore(opts.workspaceDir, opts.projectSlug);
  const unfinished = Object.values(creationStore.operations)
    .filter((operation) => operation.status !== ISSUE_CREATION_STATUS.READY)
    .map((operation) => ({
      operationId: operation.operationId,
      title: operation.input.title,
      status: operation.status,
      issueId: operation.providerIssue?.issueId,
      error: operation.lastError,
    }));

  const hold = await summarizeStateBucket(statesByType.hold, openLocalStates, opts.provider, projectionCtx);
  const active = await summarizeStateBucket(statesByType.active, openLocalStates, opts.provider, projectionCtx);
  const queue = await summarizeStateBucket(statesByType.queue, openLocalStates, opts.provider, projectionCtx);

  const totalHold = Object.values(hold).reduce((s, c) => s + c.count, 0);
  const totalActive = Object.values(active).reduce((s, c) => s + c.count, 0);
  const totalQueued = Object.values(queue).reduce((s, c) => s + c.count, 0);

  return {
    stateLabels: {
      hold: statesByType.hold.map((s) => ({ label: s.label, hint: "waiting for input" })),
      active: statesByType.active.map((s) => ({ label: s.label, role: s.role })),
      queue: statesByType.queue.map((s) => ({ label: s.label, role: s.role, priority: s.priority })),
    },
    summary: { totalHold, totalActive, totalQueued },
    hold,
    active,
    queue,
    creation: {
      pending: unfinished.filter((operation) => operation.status !== ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED && operation.error?.retryable !== false),
      failed: unfinished.filter((operation) => operation.status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED || operation.error?.retryable === false),
    },
  };
}

/** Group configured workflow states by hold, active, and queue semantics.
 * @param workflow - Effective project workflow including custom states.
 */
function getWorkflowStateLabelsByType(workflow: WorkflowConfig) {
  return {
    hold: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.HOLD),
    active: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.ACTIVE),
    queue: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.QUEUE),
  };
}

/** Render local issue summaries for each selected workflow label.
 * @param statesByType - Configured states selected for this status group.
 * @param openLocalStates - Ready open issue records eligible for the status report.
 * @param provider - Provider capability or identifier used for this operation.
 * @param projectionCtx - Authoritative snapshot and workflow used for projection comparison.
 */
async function summarizeStateBucket(
  statesByType: Pick<WorkflowConfig["states"][string], "label">[],
  openLocalStates: Awaited<ReturnType<typeof readIssueStateStore>>["issues"][string][],
  provider: Pick<IssueReader, "getIssue">,
  projectionCtx: ProjectionViewContext,
): Promise<TaskStatusResult["hold"]> {
  const bucket: TaskStatusResult["hold"] = {};

  for (const { label } of statesByType) {
    const issues = await summarizeLocalIssueStates(
      openLocalStates.filter((state) => state.workflowLabel === label),
      provider,
      projectionCtx,
    );

    bucket[label] = {
      count: issues.length,
      issues,
    };
  }

  return bucket;
}
