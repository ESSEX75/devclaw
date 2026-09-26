/**
 * transition-state.ts — Keep project-local issue runtime state in sync after heartbeat transitions.
 */
import {
  type Project,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import { withIssueOrchestrationLock } from "../../state/index.js";
import { commitWorkflowTransitionLocked } from "../pipeline/transition.js";
import type { CommitTransitionInput } from "../pipeline/types.js";

/** Recheck the local source state under the issue lock before actions and commit.
 * @param opts - Planned heartbeat transition and policy-specific provider actions.
 */
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
  /** Provider actions to perform under the lock after the local precondition is checked. */
  beforeCommit?: () => Promise<void>;
  /** Candidate routing policy rechecked under the issue lock. */
  routing?: CommitTransitionInput["routing"];
}): Promise<boolean> {
  return withIssueOrchestrationLock(opts.workspaceDir, opts.project.slug, opts.issueId, async () => {
    const issue = await opts.provider.getIssue(opts.issueId);

    return commitWorkflowTransitionLocked({
      workspaceDir: opts.workspaceDir,
      project: opts.project,
      issueId: opts.issueId,
      provider: opts.provider,
      workflow: opts.workflow,
      plan: { from: opts.fromLabel, toState: opts.workflowState, toLabel: opts.workflowLabel, actions: [] },
      owner: opts.owner,
      issue,
      closedAt: opts.closedAt,
      checkLocalState: true,
      archiveTerminal: true,
      beforeCommit: opts.beforeCommit,
      routing: opts.routing,
    });
  });
}
