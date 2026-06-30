/**
 * issues/runtime.ts — Local-state-first runtime helpers for managed issues.
 */
import type { Issue } from "../providers/provider.js";
import type { Project } from "../projects/index.js";
import {
  findStateByLabel,
  findStateKeyByLabel,
  getCurrentStateLabel,
  type WorkflowConfig,
  type StateConfig,
} from "../workflow/index.js";
import { readIssueStateStore } from "./state.js";
import type { WorkflowLabel, WorkflowStateKey } from "../domain/ids.js";
import type { IssueRuntimeState } from "./types.js";

export type IssueRuntimeResolution =
  | {
      kind: "managed";
      state: IssueRuntimeState;
      workflowLabel: WorkflowLabel;
      workflowState: WorkflowStateKey;
      stateConfig: StateConfig | null;
      providerIssue: Issue;
    }
  | {
      kind: "uninitialized";
      state: null;
      workflowLabel: WorkflowLabel | null;
      workflowState: WorkflowStateKey | null;
      stateConfig: StateConfig | null;
      providerIssue: Issue;
    };

export async function resolveIssueRuntimeState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug">;
  issue: Issue;
  workflow: WorkflowConfig;
}): Promise<IssueRuntimeResolution> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.project.slug);
  const state = store.issues[String(opts.issue.iid)];
  if (state?.managed) {
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
    workflowState: workflowLabel ? findStateKeyByLabel(opts.workflow, workflowLabel) ?? workflowLabel : null,
    stateConfig: workflowLabel ? findStateByLabel(opts.workflow, workflowLabel) ?? null : null,
    providerIssue: opts.issue,
  };
}
