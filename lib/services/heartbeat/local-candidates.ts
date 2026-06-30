/**
 * local-candidates.ts — Local issue-state candidate selection for heartbeat passes.
 */
import { readIssueStateStore, type IssueRuntimeState } from "../../issues/index.js";
import type { Issue } from "../../providers/provider.js";
import type { IssueReader } from "../../providers/capabilities.js";

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
      state.managed
      && state.archivedAt == null
      && state.integrityStatus !== "integrity_error"
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
