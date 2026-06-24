/**
 * projection-view.ts — Shared task output enrichment for local state and provider projection.
 */
import { readIssueStateStore, type IssueRuntimeState } from "../../issues/index.js";
import type { Issue } from "../../providers/provider.js";
import { diffIssueProjection } from "../../projection/index.js";
import { getStateLabels, type WorkflowConfig } from "../../workflow/index.js";

export type TaskIssueProjectionView = {
  providerLabels: string[];
  localState: {
    workflowState: string;
    workflowLabel: string;
    assignedRole?: string | null;
    assignedLevel?: string | null;
  } | null;
  integrityStatus: IssueRuntimeState["integrityStatus"];
  missingManagedLabels: string[];
  unexpectedManagedLabels: string[];
  unmanagedLabels: string[];
  repairHint: string | null;
};

export type TaskIssueSummary = {
  id: number;
  title: string;
  url: string;
  projection: TaskIssueProjectionView;
};

export type ProjectionViewContext = {
  states: Record<string, IssueRuntimeState>;
  workflow: WorkflowConfig;
  roles: string[];
};

export async function loadProjectionViewContext(opts: {
  workspaceDir: string;
  projectSlug: string;
  workflow: WorkflowConfig;
  roles: string[];
}): Promise<ProjectionViewContext> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  return {
    states: store.issues,
    workflow: opts.workflow,
    roles: opts.roles,
  };
}

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
  const needsRepair = state.integrityStatus !== "ok"
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
  };
}

function summarizeUninitializedProjection(issue: Issue): TaskIssueProjectionView {
  return {
    providerLabels: [...issue.labels].sort(),
    localState: null,
    integrityStatus: "projection_uninitialized",
    missingManagedLabels: [],
    unexpectedManagedLabels: [],
    unmanagedLabels: [...issue.labels].sort(),
    repairHint: null,
  };
}
