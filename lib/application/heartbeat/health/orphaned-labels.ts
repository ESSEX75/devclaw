/** Diagnoses orphan provider labels and delegates explicit repair to managed projection. */
import type { WorkflowConfig } from "../../../domain/index.js";
import type { Project } from "../../../domain/index.js";
import {
  DEFAULT_WORKFLOW,
} from "../../../domain/index.js";
import {
  isOwnedByOrUnclaimed,
} from "../../../domain/index.js";
import {
  getActiveLabel,
  getRevertLabel,
  hasWorkflowStates,
} from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/providers/provider.js";
import { readIssueStateStore } from "../../../state/index.js";
import {
  getProject,
  getRoleWorker,
} from "../../../state/index.js";
import { readProjects } from "../../../state/index.js";
import { HEALTH_ACTION } from "./const.js";
import { remediateProjectionFinding } from "./projection-remediation.js";
import type { HealthFix } from "./types.js";

/**
 * Scan for issues with active labels (Doing, Testing) that are NOT tracked
 * in projects.json.
 */
export async function scanOrphanedLabels(opts: {
  workspaceDir: string;
  projectSlug: string;
  project: Project;
  role: string;
  autoFix: boolean;
  provider: IssueProvider;
  workflow?: WorkflowConfig;
  instanceName?: string;
}): Promise<HealthFix[]> {
  const {
    workspaceDir, projectSlug, project, role, autoFix, provider,
    workflow = DEFAULT_WORKFLOW,
    instanceName,
  } = opts;

  const fixes: HealthFix[] = [];

  if (!hasWorkflowStates(workflow, role)) return fixes;

  const freshProject = getProject(await readProjects(workspaceDir), projectSlug);

  if (!freshProject) return fixes;

  const roleWorker = getRoleWorker(freshProject, role);
  const issueStore = await readIssueStateStore(workspaceDir, projectSlug);
  const activeLabel = getActiveLabel(workflow, role);
  const queueLabel = getRevertLabel(workflow, role);

  const issuesWithLabel = await provider.listIssuesByLabel(activeLabel);

  const ownedIssues = issuesWithLabel.filter((issue) => {
    const localState = issueStore.issues[String(issue.iid)];

    if (!instanceName) return true;
    if (!localState) {
      // Without local state, the provider label is only a diagnostic scoping hint;
      // this scan never imports it into runtime state.
      return isOwnedByOrUnclaimed(issue.labels, instanceName);
    }

    return localState.owner == null || localState.owner === instanceName;
  });

  for (const issue of ownedIssues) {
    let isTracked = false;

    for (const slots of Object.values(roleWorker.levels)) {
      if (slots === undefined) continue;

      if (slots.some(slot => slot.active && slot.issueId === issue.iid)) {
        isTracked = true;
        break;
      }
    }

    if (!isTracked) {
      const fix: HealthFix = {
        issue: {
          type: "orphaned_label",
          severity: "critical",
          project: project.name,
          projectSlug,
          role,
          issueId: issue.iid,
          expectedLabel: queueLabel,
          actualLabel: activeLabel,
          message: `Issue #${issue.iid} has "${activeLabel}" label but no ${role.toUpperCase()} slot is tracking it`,
        },
        fixed: false,
        plannedAction: issueStore.issues[String(issue.iid)] ? HEALTH_ACTION.RECONCILE_PROJECTION : undefined,
      };

      fixes.push(autoFix && fix.plannedAction
        ? await remediateProjectionFinding({ ...opts, workflow }, fix)
        : fix);

    }
  }

  return fixes;
}
