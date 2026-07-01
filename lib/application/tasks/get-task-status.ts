import { readIssueStateStore } from "../../state/issues/index.js";
import type { IssueReader } from "../../providers/capabilities.js";
import { StateType, type WorkflowConfig } from "../../domain/workflow/types.js";
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
  const openLocalStates = Object.values(store.issues)
    .filter((state) => state.managed && state.archivedAt == null && state.closedAt == null);

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
  };
}

function getWorkflowStateLabelsByType(workflow: WorkflowConfig) {
  return {
    hold: Object.values(workflow.states).filter((state) => state.type === StateType.HOLD),
    active: Object.values(workflow.states).filter((state) => state.type === StateType.ACTIVE),
    queue: Object.values(workflow.states).filter((state) => state.type === StateType.QUEUE),
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
