import type { IssueRuntimeState } from "../../domain/index.js";
import {
  findStateByLabel,
  STATE_TYPE,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import { readIssueStateStore } from "../../state/issues/index.js";
import {
  loadProjectionViewContext,
  summarizeLocalIssueStates,
  type TaskIssueSummary,
} from "./projection-summary.js";

type FetchEntry = { label: string; type: string; role?: string; issueState: "open" | "closed" | "all" };

export type TaskListStateGroup = {
  label: string;
  type: string;
  role?: string;
  issues: TaskIssueSummary[];
  total: number;
};

export type TaskListResult = {
  filter: { stateType: string | null; label: string | null; search: string | null };
  states: TaskListStateGroup[];
  totalIssues: number;
};

export async function listManagedTasks(opts: {
  workspaceDir: string;
  projectSlug: string;
  workflow: WorkflowConfig;
  roles: string[];
  provider: Pick<IssueReader, "getIssue">;
  stateType?: string;
  label?: string;
  search?: string;
  limit?: number;
}): Promise<TaskListResult> {
  const limit = opts.limit ?? 20;
  const projectionCtx = await loadProjectionViewContext({
    workspaceDir: opts.workspaceDir,
    projectSlug: opts.projectSlug,
    workflow: opts.workflow,
    roles: opts.roles,
  });
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const localStates = Object.values(store.issues)
    .filter((state) => state.archivedAt == null);
  const labelsToFetch = resolveTaskListLabels(opts.workflow, opts.stateType, opts.label);
  const searchLower = opts.search?.toLowerCase();
  const results: TaskListStateGroup[] = [];

  for (const entry of labelsToFetch) {
    let states = localStates.filter((state) => state.workflowLabel === entry.label);

    if (searchLower) {
      const filtered: IssueRuntimeState[] = [];

      for (const state of states) {
        const issue = await opts.provider.getIssue(state.issueId).catch(() => null);

        if ((issue?.title ?? `Issue #${state.issueId}`).toLowerCase().includes(searchLower)) {
          filtered.push(state);
        }
      }

      states = filtered;
    }

    const total = states.length;
    const limited = states.slice(0, limit);

    results.push({
      label: entry.label,
      type: entry.type,
      role: entry.role,
      issues: await summarizeLocalIssueStates(limited, opts.provider, projectionCtx),
      total,
    });
  }

  return {
    filter: { stateType: opts.stateType ?? null, label: opts.label ?? null, search: opts.search ?? null },
    states: opts.label ? results : results.filter((r) => r.total > 0),
    totalIssues: results.reduce((sum, r) => sum + r.total, 0),
  };
}

function resolveTaskListLabels(workflow: WorkflowConfig, stateType?: string, label?: string): FetchEntry[] {
  if (label) {
    const stateConfig = findStateByLabel(workflow, label);

    if (!stateConfig) throw new Error(`Unknown state label "${label}". Check workflow_guide for valid states.`);

    return [{
      label: stateConfig.label,
      type: stateConfig.type,
      role: stateConfig.role,
      issueState: stateConfig.type === STATE_TYPE.TERMINAL ? "closed" : "open",
    }];
  }

  const includeTerminal = stateType === "terminal" || stateType === "all";
  const entries: FetchEntry[] = [];

  for (const state of Object.values(workflow.states)) {
    if (state.type === STATE_TYPE.TERMINAL && !includeTerminal) continue;
    if (stateType && stateType !== "all" && state.type !== stateType) continue;
    entries.push({
      label: state.label,
      type: state.type,
      role: state.role,
      issueState: state.type === STATE_TYPE.TERMINAL ? "closed" : "open",
    });
  }

  return entries;
}
