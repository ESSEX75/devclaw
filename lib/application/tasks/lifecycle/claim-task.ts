/** Owns a managed task lifecycle operation or its pure transition decision. */

import {
  isIssueCreationReady,
  readIssueStateStore,
  withIssueOrchestrationLock,
} from "../../../state/index.js";
import { writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import { TASK_CLAIM_OWNER } from "./const.js";
import type { ClaimManagedTaskInput, ClaimManagedTaskResult } from "./types.js";

/** Transfer issue ownership under the orchestration lock only after creation is ready.
 * @param input - Validated command dependencies and requested changes.
 */
export async function claimManagedTask(input: ClaimManagedTaskInput): Promise<ClaimManagedTaskResult> {
  return withIssueOrchestrationLock(
    input.workspaceDir,
    input.project.slug,
    input.issueId,
    async () => {
      const store = await readIssueStateStore(input.workspaceDir, input.project.slug);
      const state = store.issues[String(input.issueId)];

      if (!state) return { claimed: false, reason: "Local issue state is not initialized" };
      if (!await isIssueCreationReady(input.workspaceDir, input.project.slug, state.creationOperationId)) {
        return { claimed: false, reason: "Issue creation is not ready" };
      }

      if (state.owner === input.instanceName) {
        return { claimed: false, reason: "Already owned by this instance" };
      }

      if (state.owner && !input.force) {
        return { claimed: false, reason: `Owned by "${state.owner}". Use force=true to transfer.` };
      }

      const issue = await input.provider.getIssue(input.issueId);

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
        owner: TASK_CLAIM_OWNER,
      });

      return { claimed: true };
    },
  );
}
