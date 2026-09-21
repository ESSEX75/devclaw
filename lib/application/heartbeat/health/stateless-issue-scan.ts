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
import { readIssueStateStore } from "../../../state/index.js";
import { reconcileManagedLabels } from "../../projection/index.js";
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

  let allOpenIssues;

  try {
    allOpenIssues = await provider.listIssues({ state: "open" });
  } catch {
    return fixes;
  }

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
    if (instanceName && !isOwnedByOrUnclaimed(issue.labels, instanceName)) continue;
    const localState = store.issues[String(issue.iid)];
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
    };

    if (autoFix) {
      if (!localState) {
        fix.issue.message += " Local state is not initialized; explicit backfill/repair is required.";
        fixes.push(fix);
        continue;
      }

      try {
        await reconcileManagedLabels({
          workspaceDir,
          projectSlug,
          issueId: issue.iid,
          workflow,
          provider,
          owner: "heartbeat_stateless_recovery",
        });
        fix.fixed = true;
        fix.labelReverted = `(none) → ${localState.workflowLabel}`;

        await auditLog(workspaceDir, "stateless_issue_recovered", {
          project: project.name,
          issueId: issue.iid,
          restoredTo: localState.workflowLabel,
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
