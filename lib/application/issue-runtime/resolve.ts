/** Resolves local issue truth; provider labels describe only uninitialized issues. */

import { findStateByLabel, findStateKeyByLabel, getCurrentStateLabel } from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";
import { ISSUE_RUNTIME_KIND } from "./const.js";
import type { IssueRuntimeResolution, IssueRuntimeResolveInput } from "./types.js";

/** Resolve local state without accepting provider drift as an authoritative change.
 * A managed record whose key and label do not match current configuration has no stateConfig.
 * @param opts - Workspace, project, provider snapshot, and current workflow.
 */
export async function resolveIssueRuntimeState(opts: IssueRuntimeResolveInput): Promise<IssueRuntimeResolution> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.project.slug);
  const state = store.issues[String(opts.issue.iid)];

  if (state) {
    const configured = opts.workflow.states[state.workflowState];

    return {
      kind: ISSUE_RUNTIME_KIND.MANAGED,
      state,
      workflowLabel: state.workflowLabel,
      workflowState: state.workflowState,
      stateConfig: configured?.label === state.workflowLabel ? configured : null,
    };
  }

  const workflowLabel = getCurrentStateLabel(opts.issue.labels, opts.workflow);

  return {
    kind: ISSUE_RUNTIME_KIND.UNINITIALIZED,
    state: null,
    workflowLabel,
    workflowState: workflowLabel ? findStateKeyByLabel(opts.workflow, workflowLabel) : null,
    stateConfig: workflowLabel ? findStateByLabel(opts.workflow, workflowLabel) ?? null : null,
  };
}
