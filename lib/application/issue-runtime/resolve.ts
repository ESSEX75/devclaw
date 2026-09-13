/**
 * Resolves managed-issue runtime state while keeping provider projection interpretation in the application layer.
 */
import {
  findStateByLabel,
  findStateKeyByLabel,
  getCurrentStateLabel,
  type IssueRuntimeState,
  type Project,
  type WorkflowConfig,
  type WorkflowStateConfig,
} from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";

/** Provider projection fields needed only to report initialization state. */
export type IssueProjectionSnapshot = {
  /** Provider-local issue identifier. */
  iid: number;
  /** Current provider-visible labels. */
  labels: string[];
};

/** Describes whether authoritative local runtime state exists for an issue. */
export type IssueRuntimeResolution =
  | {
    /** Indicates that local runtime state is authoritative. */
    kind: "managed";
    /** Authoritative local runtime state. */
    state: IssueRuntimeState;
    /** Workflow label recorded in local state. */
    workflowLabel: string;
    /** Workflow state key recorded in local state. */
    workflowState: string;
    /** Current workflow configuration for the recorded label, when still configured. */
    stateConfig: WorkflowStateConfig | null;
  }
  | {
    /** Indicates that no authoritative local runtime state exists yet. */
    kind: "uninitialized";
    /** Confirms the absence of authoritative local runtime state. */
    state: null;
    /** Provider-visible workflow label interpreted as projection data. */
    workflowLabel: string | null;
    /** Workflow state key inferred from the provider projection. */
    workflowState: string | null;
    /** Current workflow configuration inferred from the provider projection. */
    stateConfig: WorkflowStateConfig | null;
  };

/**
 * Resolve authoritative local issue state, falling back to provider labels only for uninitialized issues.
 *
 * @param opts - Workspace, project, provider projection, and workflow used for resolution.
 * @returns The managed local state or an explicitly uninitialized projection interpretation.
 */
export async function resolveIssueRuntimeState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug">;
  issue: IssueProjectionSnapshot;
  workflow: WorkflowConfig;
}): Promise<IssueRuntimeResolution> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.project.slug);
  const state = store.issues[String(opts.issue.iid)];

  if (state) {
    const stateConfig = findStateByLabel(opts.workflow, state.workflowLabel) ?? null;

    return {
      kind: "managed",
      state,
      workflowLabel: state.workflowLabel,
      workflowState: state.workflowState,
      stateConfig,
    };
  }

  const workflowLabel = getCurrentStateLabel(opts.issue.labels, opts.workflow);

  return {
    kind: "uninitialized",
    state: null,
    workflowLabel,
    workflowState: workflowLabel ? findStateKeyByLabel(opts.workflow, workflowLabel) : null,
    stateConfig: workflowLabel ? findStateByLabel(opts.workflow, workflowLabel) ?? null : null,
  };
}
