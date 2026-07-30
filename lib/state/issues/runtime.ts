/**
 * issues/runtime.ts — Local-state-first runtime helpers for managed issues.
 */
import {
  findStateByLabel,
  findStateKeyByLabel,
  getCurrentStateLabel,
  type IssueRuntimeState,
  type Project,
  type StateConfig,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { readIssueStateStore } from "./store.js";

export type IssueRuntimeResolution =
  | {
    kind: "managed";
    state: IssueRuntimeState;
    workflowLabel: string;
    workflowState: string;
    stateConfig: StateConfig<string, string, string> | null;
    providerIssue: Issue;
  }
  | {
    kind: "uninitialized";
    state: null;
    workflowLabel: string | null;
    workflowState: string | null;
    stateConfig: StateConfig<string, string, string> | null;
    providerIssue: Issue;
  };

export async function resolveIssueRuntimeState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug">;
  issue: Issue;
  workflow: WorkflowConfig<string, string, string>;
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
      providerIssue: opts.issue,
    };
  }

  const workflowLabel = getCurrentStateLabel(opts.issue.labels, opts.workflow);

  return {
    kind: "uninitialized",
    state: null,
    workflowLabel,
    workflowState: workflowLabel ? findStateKeyByLabel(opts.workflow, workflowLabel) : null,
    stateConfig: workflowLabel ? findStateByLabel(opts.workflow, workflowLabel) ?? null : null,
    providerIssue: opts.issue,
  };
}
