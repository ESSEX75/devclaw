/** Commits workflow transitions shared by agent completion and heartbeat review passes. */
import {
  getStateLabels,
  ISSUE_ARCHIVE_REASON,
  STATE_TYPE,
} from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { archiveManagedIssueLocked } from "../issues/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import type { CommitTransitionInput } from "./types.js";

/** Apply provider label, persist local truth, reconcile projection, and optionally archive.
 * The caller owns the issue lock and performs policy-specific actions separately.
 * @param input - Resolved transition and current issue snapshot.
 */
export async function commitWorkflowTransitionLocked(input: CommitTransitionInput): Promise<boolean> {
  const { workspaceDir, project, issueId, provider, workflow, plan, owner, issue } = input;

  if (input.checkLocalState) {
    const store = await readIssueStateStore(workspaceDir, project.slug);

    const state = store.issues[String(issueId)];

    if (state?.workflowLabel !== plan.from) return false;
    if (input.routing && state[input.routing.field] !== input.routing.value) return false;
  }

  await input.beforeCommit?.();
  await provider.transitionLabel(issueId, plan.from, plan.toLabel);
  await input.afterLabel?.();
  const labels = issue.labels.filter((label) => !getStateLabels(workflow).includes(label)).concat(plan.toLabel);

  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: { ...issue, labels },
    providerType: project.provider,
    workflow,
    workflowState: plan.toState,
    workflowLabel: plan.toLabel,
    activeWorker: null,
    closedAt: input.closedAt,
  });
  await reconcileManagedLabelsLocked({
    workspaceDir,
    projectSlug: project.slug,
    issueId,
    workflow,
    roles: input.roles,
    provider,
    owner,
  });

  if (input.archiveTerminal && workflow.states[plan.toState]?.type === STATE_TYPE.TERMINAL) {
    const archived = await archiveManagedIssueLocked({
      workspaceDir,
      projectSlug: project.slug,
      issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
      snapshot: { title: issue.title, issueUrl: issue.web_url },
      actor: owner,
      correlationId: `terminal:${project.slug}:${issueId}:${plan.toState}`,
    });

    if (!archived.archived && archived.reason !== "notification_pending") {
      throw new Error(`Terminal issue #${issueId} could not be archived: ${archived.reason ?? "unknown"}.`);
    }
  }

  return true;
}
