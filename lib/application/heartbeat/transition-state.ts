/**
 * transition-state.ts — Keep project-local issue runtime state in sync after heartbeat transitions.
 */
import {
  getStateLabels,
  ISSUE_PROVIDER,
  type IssueProviderType,
  type Project,
  type WorkflowConfig,
  type WorkflowLabel,
  type WorkflowStateKey,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { writeIssueRuntimeState } from "../../state/issues/index.js";

export async function writeHeartbeatTransitionState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  issue: Issue;
  workflow: WorkflowConfig;
  workflowState: WorkflowStateKey;
  workflowLabel: WorkflowLabel;
  closedAt?: string | null;
}): Promise<void> {
  const stateLabels = new Set(getStateLabels(opts.workflow));
  const labels = opts.issue.labels
    .filter((label) => !stateLabels.has(label))
    .concat(opts.workflowLabel);

  await writeIssueRuntimeState({
    workspaceDir: opts.workspaceDir,
    project: opts.project,
    issue: {
      ...opts.issue,
      labels,
    },
    providerType: providerType(opts.project.provider),
    workflow: opts.workflow,
    workflowState: opts.workflowState,
    workflowLabel: opts.workflowLabel,
    activeWorker: null,
    closedAt: opts.closedAt,
  });
}

function providerType(provider: Project["provider"]): IssueProviderType {
  return provider === ISSUE_PROVIDER.GITLAB ? ISSUE_PROVIDER.GITLAB : ISSUE_PROVIDER.GITHUB;
}
