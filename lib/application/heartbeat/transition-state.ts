/**
 * transition-state.ts — Keep project-local issue runtime state in sync after heartbeat transitions.
 */
import {
  getStateLabels,
  ISSUE_PROVIDER,
  type IssueProviderId,
  type Project,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import {
  readIssueStateStore,
  withIssueOrchestrationLock,
  writeIssueRuntimeState,
} from "../../state/issues/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";

export async function transitionHeartbeatIssue(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  issueId: number;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  fromLabel: string;
  workflowState: string;
  workflowLabel: string;
  closedAt?: string | null;
  owner: string;
}): Promise<boolean> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.project.slug, opts.issueId, async () => {
    const store = await readIssueStateStore(opts.workspaceDir, opts.project.slug);
    const state = store.issues[String(opts.issueId)];

    if (!state || state.workflowLabel !== opts.fromLabel) return false;

    const issue = await opts.provider.getIssue(opts.issueId);

    await opts.provider.transitionLabel(opts.issueId, opts.fromLabel, opts.workflowLabel);
    await writeHeartbeatTransitionState({ ...opts, issue });
    await reconcileManagedLabelsLocked({
      workspaceDir: opts.workspaceDir,
      projectSlug: opts.project.slug,
      issueId: opts.issueId,
      workflow: opts.workflow,
      provider: opts.provider,
      owner: opts.owner,
    });

    return true;
  });
}

export async function writeHeartbeatTransitionState(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels" | "provider">;
  issue: Issue;
  workflow: WorkflowConfig;
  workflowState: string;
  workflowLabel: string;
  closedAt?: string | null;
}): Promise<void> {
  const stateLabels = new Set<string>(getStateLabels(opts.workflow));
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

function providerType(provider: Project["provider"]): IssueProviderId {
  return provider === ISSUE_PROVIDER.GITLAB ? ISSUE_PROVIDER.GITLAB : ISSUE_PROVIDER.GITHUB;
}
