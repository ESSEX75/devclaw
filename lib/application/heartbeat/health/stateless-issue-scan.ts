import { log as auditLog } from "../../../audit.js";
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
import type { HealthFix } from "./types.js";

/**
 * Scan for open, DevClaw-managed issues that have lost their state label.
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
  const {
    workspaceDir, projectSlug, project, provider,
    workflow = DEFAULT_WORKFLOW,
    autoFix,
    instanceName,
  } = opts;

  const fixes: HealthFix[] = [];
  const stateLabels = new Set<string>(getStateLabels(workflow));
  const initialLabel = workflow.states[workflow.initial]?.label;

  if (!initialLabel) return fixes;

  let allOpenIssues;

  try {
    allOpenIssues = await provider.listIssues({ state: "open" });
  } catch {
    return fixes;
  }

  for (const issue of allOpenIssues) {
    const hasStateLabel = issue.labels.some((label) => stateLabels.has(label));

    if (hasStateLabel) continue;

    const hasWorkflowLabels = issue.labels.some((l) =>
      l.startsWith("developer:") || l.startsWith("tester:") || l.startsWith("reviewer:") ||
      l.startsWith("architect:") || l.startsWith("review:") || l.startsWith("test:") ||
      l.startsWith("owner:") || l.startsWith("notify:"),
    );

    if (!hasWorkflowLabels) continue;
    if (instanceName && !isOwnedByOrUnclaimed(issue.labels, instanceName)) continue;

    const fix: HealthFix = {
      issue: {
        type: "stateless_issue",
        severity: "critical",
        project: project.name,
        projectSlug,
        role: "developer",
        issueId: String(issue.iid),
        expectedLabel: initialLabel,
        actualLabel: null,
        message: `Issue #${issue.iid} has no state label — invisible to queue scanner. Labels: [${issue.labels.join(", ")}]`,
      },
      fixed: false,
    };

    if (autoFix) {
      try {
        await provider.ensureLabel(initialLabel, "");
        await provider.addLabel(issue.iid, initialLabel);
        fix.fixed = true;
        fix.labelReverted = `(none) → ${initialLabel}`;

        await auditLog(workspaceDir, "stateless_issue_recovered", {
          project: project.name,
          issueId: issue.iid,
          restoredTo: initialLabel,
          originalLabels: issue.labels,
        });
      } catch {
        fix.labelRevertFailed = true;
      }
    }

    fixes.push(fix);
  }

  return fixes;
}
