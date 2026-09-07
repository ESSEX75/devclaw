import { ISSUE_CREATION_STATUS, type IssueCreationFailure, STATE_TYPE, type WorkflowConfig } from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import { isIssueCreationReady, readIssueCreationStore, readIssueStateStore } from "../../state/issues/index.js";
import {
  loadProjectionViewContext,
  summarizeLocalIssueStates,
  type TaskIssueSummary,
} from "./projection-summary.js";

type IssueSummary = TaskIssueSummary;

type StateBucket = Record<string, { count: number; issues: IssueSummary[] }>;

export type TaskStatusResult = {
  stateLabels: {
    hold: Array<{ label: string; hint: string }>;
    active: Array<{ label: string; role?: string }>;
    queue: Array<{ label: string; role?: string; priority?: number }>;
  };
  summary: { totalHold: number; totalActive: number; totalQueued: number };
  hold: StateBucket;
  active: StateBucket;
  queue: StateBucket;
  creation: {
    pending: Array<{ operationId: string; title: string; status: string; issueId?: number; error?: IssueCreationFailure }>;
    failed: Array<{ operationId: string; title: string; status: string; issueId?: number; error?: IssueCreationFailure }>;
  };
};

export async function getManagedTaskStatus(opts: {
  workspaceDir: string;
  projectSlug: string;
  workflow: WorkflowConfig;
  roles: string[];
  provider: Pick<IssueReader, "getIssue">;
}): Promise<TaskStatusResult> {
  const statesByType = getWorkflowStateLabelsByType(opts.workflow);
  const projectionCtx = await loadProjectionViewContext({
    workspaceDir: opts.workspaceDir,
    projectSlug: opts.projectSlug,
    workflow: opts.workflow,
    roles: opts.roles,
  });
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
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

function getWorkflowStateLabelsByType(workflow: WorkflowConfig) {
  return {
    hold: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.HOLD),
    active: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.ACTIVE),
    queue: Object.values(workflow.states).filter((state) => state.type === STATE_TYPE.QUEUE),
  };
}

async function summarizeStateBucket(
  statesByType: Array<{ label: string }>,
  openLocalStates: Awaited<ReturnType<typeof readIssueStateStore>>["issues"][string][],
  provider: Pick<IssueReader, "getIssue">,
  projectionCtx: Awaited<ReturnType<typeof loadProjectionViewContext>>,
): Promise<StateBucket> {
  const bucket: StateBucket = {};

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
