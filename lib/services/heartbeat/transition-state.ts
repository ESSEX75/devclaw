/**
 * transition-state.ts — Keep project-local issue runtime state in sync after heartbeat transitions.
 */
import { writeIssueRuntimeState, type IssueProvider as IssueProviderKind } from "../../issues/index.js";
import type { Project } from "../../projects/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import type { WorkflowConfig } from "../../domain/workflow/types.js";
import { getStateLabels } from "../../domain/workflow/queries.js";

export async function writeHeartbeatTransitionState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  issue: Issue;
  workflow: WorkflowConfig;
  workflowState: string;
  workflowLabel: string;
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

function providerType(provider: Project["provider"]): IssueProviderKind {
  return provider === "gitlab" ? "gitlab" : "github";
}
