import type { IssueProviderId, Project, WorkflowConfig } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import {
  readIssueStateStore,
  withIssueOrchestrationLock,
  writeIssueRuntimeState,
} from "../../state/issues/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";

export type ClaimManagedTaskResult =
  | { claimed: true }
  | { claimed: false; reason: string };

export async function claimManagedTask(input: {
  workspaceDir: string;
  project: Project;
  issueId: number;
  instanceName: string;
  force: boolean;
  provider: IssueProvider;
  providerType: IssueProviderId;
  workflow: WorkflowConfig;
  roles: string[];
}): Promise<ClaimManagedTaskResult> {
  return withIssueOrchestrationLock(
    input.workspaceDir,
    input.project.slug,
    input.issueId,
    async () => {
      const store = await readIssueStateStore(input.workspaceDir, input.project.slug);
      const state = store.issues[String(input.issueId)];

      if (!state) return { claimed: false, reason: "Local issue state is not initialized" };
      if (state.owner === input.instanceName) {
        return { claimed: false, reason: "Already owned by this instance" };
      }

      if (state.owner && !input.force) {
        return { claimed: false, reason: `Owned by "${state.owner}". Use force=true to transfer.` };
      }

      const issue = await input.provider.getIssue(input.issueId);

      if (issue.state === "closed" || issue.state === "CLOSED") {
        return { claimed: false, reason: "Issue is closed" };
      }

      await writeIssueRuntimeState({
        workspaceDir: input.workspaceDir,
        project: input.project,
        issue,
        providerType: input.providerType,
        workflow: input.workflow,
        workflowLabel: state.workflowLabel,
        workflowState: state.workflowState,
        owner: input.instanceName,
      });
      await reconcileManagedLabelsLocked({
        workspaceDir: input.workspaceDir,
        projectSlug: input.project.slug,
        issueId: input.issueId,
        workflow: input.workflow,
        roles: input.roles,
        provider: input.provider,
        owner: "task_owner",
      });

      return { claimed: true };
    },
  );
}
