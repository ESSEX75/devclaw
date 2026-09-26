/** Explicit repair of health projection findings using fresh managed state under the issue lock. */
import { getStateLabels, type Project, type WorkflowConfig } from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/providers/provider.js";
import { getProject, getRoleWorker, readIssueStateStore, readProjects, withIssueOrchestrationLock } from "../../../state/index.js";
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import type { HealthFix } from "./types.js";

/** Repair a diagnosed label only while its original health condition still holds.
 * @param input - Managed project identity, ownership scope, and provider capability.
 * @param finding - Read-only orphan or stateless finding.
 */
export async function remediateProjectionFinding(input: {
  workspaceDir: string;
  projectSlug: string;
  project: Project;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  instanceName?: string;
}, finding: HealthFix): Promise<HealthFix> {
  const { workspaceDir, projectSlug, provider, workflow } = input;
  const issueId = finding.issue.issueId;

  if (!issueId) return finding;
  try {
    return await withIssueOrchestrationLock(workspaceDir, projectSlug, issueId, async () => {
      const state = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];

      if (!state) return { ...finding, plannedAction: undefined };
      if (input.instanceName && state.owner != null && state.owner !== input.instanceName) return finding;
      const issue = await provider.getIssue(issueId);

      if (finding.issue.type === "orphaned_label") {
        const project = getProject(await readProjects(workspaceDir), projectSlug);

        if (!project) return finding;
        const worker = getRoleWorker(project, finding.issue.role);

        if (Object.values(worker.levels).some((slots) => slots?.some((slot) => slot.active && slot.issueId === issueId))) return finding;
        if (!issue.labels.includes(finding.issue.actualLabel ?? "")) return finding;
      } else if (issue.labels.some((label) => getStateLabels(workflow).includes(label))) return finding;
      // A true untracked active issue needs operator repair; label projection alone cannot claim it.
      if (issue.labels.includes(state.workflowLabel)) return finding;
      const repaired = await reconcileManagedLabelsLocked({ workspaceDir, projectSlug, issueId, provider, workflow, owner: "heartbeat_health_projection" });

      return {
        ...finding, fixed: repaired.changed,
        issue: { ...finding.issue, expectedLabel: state.workflowLabel },
        labelReverted: `${finding.issue.actualLabel ?? "(none)"} → ${state.workflowLabel}`,
      };
    });
  } catch (error) {
    return { ...finding, labelRevertFailed: true, error: error instanceof Error ? error.message : String(error) };
  }
}
