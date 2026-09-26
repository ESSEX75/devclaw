/** Diagnoses missing state labels without initializing provider-only issues. */
import type { WorkflowConfig } from "../../../domain/index.js";
import type { Project } from "../../../domain/index.js";
import {
  DEFAULT_WORKFLOW,
} from "../../../domain/index.js";
import {
  isOwnedByOrUnclaimed,
} from "../../../domain/index.js";
import {
  getStateLabels,
} from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/providers/provider.js";
import { readIssueStateStore } from "../../../state/index.js";
import { HEALTH_ACTION } from "./const.js";
import { remediateProjectionFinding } from "./projection-remediation.js";
import type { HealthFix } from "./types.js";

/**
 * Scan for open, DevClaw-managed issues that have lost their state label.
 *
 * @param opts - Project, provider, workflow, and repair behavior for the scan.
 */
export async function scanStatelessIssues(opts: {
  workspaceDir: string;
  projectSlug: string;
  project: Project;
  provider: IssueProvider;
  workflow?: WorkflowConfig;
  autoFix: boolean;
  instanceName?: string;
}): Promise<HealthFix[]> {
  const { workspaceDir, projectSlug, project, provider, autoFix, instanceName } = opts;
  const workflow: WorkflowConfig = opts.workflow ?? DEFAULT_WORKFLOW;

  const fixes: HealthFix[] = [];
  const stateLabels = new Set<string>(getStateLabels(workflow));
  const workflowRoles = [...new Set(
    Object.values(workflow.states)
      .map((state) => state.role)
      .filter((role): role is string => role !== undefined),
  )];
  const store = await readIssueStateStore(workspaceDir, projectSlug);

  const allOpenIssues = await provider.listIssues({ state: "open" });

  for (const issue of allOpenIssues) {
    const hasStateLabel = issue.labels.some((label) => stateLabels.has(label));

    if (hasStateLabel) continue;

    const projectedRole = workflowRoles.find((role) =>
      issue.labels.some((label) => label.startsWith(`${role}:`)),
    );

    const hasWorkflowLabels = projectedRole !== undefined || issue.labels.some((label) =>
      label.startsWith("review:")
      || label.startsWith("test:")
      || label.startsWith("owner:")
      || label.startsWith("notify:"),
    );

    if (!hasWorkflowLabels) continue;
    // Provider ownership is only a diagnostic scoping hint here because no
    // authoritative local runtime state may exist for this issue.
    const localState = store.issues[String(issue.iid)];

    if (instanceName && (localState
      ? localState.owner != null && localState.owner !== instanceName
      : !isOwnedByOrUnclaimed(issue.labels, instanceName))) continue;
    const expectedLabel = localState?.workflowLabel ?? null;

    const fix: HealthFix = {
      issue: {
        type: "stateless_issue",
        severity: "critical",
        project: project.name,
        projectSlug,
        role: projectedRole ?? "developer",
        issueId: issue.iid,
        expectedLabel,
        actualLabel: null,
        message: `Issue #${issue.iid} has no state label — invisible to queue scanner. Labels: [${issue.labels.join(", ")}]`,
      },
      fixed: false,
      plannedAction: localState ? HEALTH_ACTION.RECONCILE_PROJECTION : undefined,
    };

    if (!localState) fix.issue.message += " Local state is not initialized; explicit repair is required.";
    fixes.push(autoFix && fix.plannedAction
      ? await remediateProjectionFinding({ ...opts, workflow }, fix)
      : fix);
  }

  return fixes;
}
