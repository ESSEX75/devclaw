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
import { readIssueStateStore } from "../../../state/issues/index.js";
import {
  getProject,
  getRoleWorker,
} from "../../../state/projects/index.js";
import { readProjects } from "../../../state/projects/index.js";
import { reconcileManagedLabels } from "../../projection/index.js";
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

  let freshProject: Project;

  try {
    const data = await readProjects(workspaceDir);

    freshProject = getProject(data, projectSlug) ?? project;
  } catch {
    freshProject = project;
  }

  const roleWorker = getRoleWorker(freshProject, role);
  const issueStore = await readIssueStateStore(workspaceDir, projectSlug);
  const activeLabel = getActiveLabel(workflow, role);
  const queueLabel = getRevertLabel(workflow, role);

  let issuesWithLabel;

  try {
    issuesWithLabel = await provider.listIssuesByLabel(activeLabel);
  } catch {
    return fixes;
  }

  const ownedIssues = instanceName
    ? issuesWithLabel.filter((i) => isOwnedByOrUnclaimed(i.labels, instanceName))
    : issuesWithLabel;

  for (const issue of ownedIssues) {
    const issueIdStr = String(issue.iid);

    let isTracked = false;

    for (const slots of Object.values(roleWorker.levels)) {
      if (slots === undefined) continue;

      if (slots.some(slot => slot.active && slot.issueId === issueIdStr)) {
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
          issueId: issueIdStr,
          expectedLabel: queueLabel,
          actualLabel: activeLabel,
          message: `Issue #${issue.iid} has "${activeLabel}" label but no ${role.toUpperCase()} slot is tracking it`,
        },
        fixed: false,
      };

      if (autoFix) {
        try {
          const localState = issueStore.issues[String(issue.iid)];

          if (!localState) throw new Error("Local issue state is not initialized");
          await reconcileManagedLabels({
            workspaceDir,
            projectSlug,
            issueId: issue.iid,
            workflow,
            provider,
            owner: "heartbeat_orphaned_label_recovery",
          });
          fix.fixed = true;
          fix.labelReverted = `${activeLabel} → ${localState.workflowLabel}`;
          fix.issue.expectedLabel = localState.workflowLabel;
        } catch {
          fix.labelRevertFailed = true;
        }
      }

      fixes.push(fix);
    }
  }

  return fixes;
}
