/**
 * local-candidates.ts — Local issue-state candidate selection for heartbeat passes.
 */
import { ISSUE_INTEGRITY_STATUS, type IssueRuntimeState } from "../../domain/index.js";
import type { IssueReader } from "../../integrations/providers/capabilities.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { readIssueStateStore } from "../../state/issues/index.js";

export async function getHeartbeatCandidates(opts: {
  workspaceDir: string;
  projectSlug: string;
  workflowLabel: string;
  provider: Pick<IssueReader, "getIssue">;
  routing?: {
    field: "reviewPolicy" | "testPolicy";
    value: string;
  };
}): Promise<Array<{ issue: Issue; localState: IssueRuntimeState }>> {
  const store = await readIssueStateStore(opts.workspaceDir, opts.projectSlug);
  const states = Object.values(store.issues)
    .filter((state) =>
      state.integrityStatus !== ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
      && state.providerMissing == null
      && state.workflowLabel === opts.workflowLabel
      && (!opts.routing || state[opts.routing.field] === opts.routing.value),
    )
    .sort((a, b) => a.issueId - b.issueId);

  const candidates: Array<{ issue: Issue; localState: IssueRuntimeState }> = [];

  for (const localState of states) {
    try {
      const issue = await opts.provider.getIssue(localState.issueId);

      if (issue.state === "closed" || issue.state === "CLOSED") continue;
      candidates.push({ issue, localState });
    } catch {
      // Projection pass handles provider-missing cleanup and provider errors.
    }
  }

  return candidates;
}
