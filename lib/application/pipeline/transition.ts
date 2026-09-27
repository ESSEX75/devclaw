/** Commits workflow transitions shared by agent completion and heartbeat review passes. */

import {
  getStateLabels,
  ISSUE_ARCHIVE_REASON,
  PIPELINE_NOTIFICATION_STATUS,
  STATE_TYPE,
} from "../../domain/index.js";
import { readIssueStateStore, readOptionalProjects } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { archiveManagedIssueLocked } from "../issues/index.js";
import { NOTIFICATION_EVENT } from "../notifications/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import { findTransitionWorker, releaseTransitionWorkerLocked } from "./recovery.js";
import type { CommitTransitionInput } from "./types.js";

/** Apply provider label, persist local truth, reconcile projection, and optionally archive.
 * The caller owns the issue lock and performs policy-specific actions separately.
 * @param input - Resolved transition and current issue snapshot.
 */
export async function commitWorkflowTransitionLocked(input: CommitTransitionInput): Promise<boolean> {
  const { workspaceDir, project, issueId, provider, workflow, plan, owner, issue } = input;

  const state = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];

  if (input.checkLocalState) {

    if (state?.workflowLabel !== plan.from) return false;
    if (input.routing && state[input.routing.field] !== input.routing.value) return false;
  }

  if (state?.pendingWorkerRelease) throw new Error(`Issue #${issueId} has an unfinished worker release.`);
  const terminal = workflow.states[plan.toState]?.type === STATE_TYPE.TERMINAL;
  const eventKey = `${NOTIFICATION_EVENT.PIPELINE_COMPLETE}:${plan.toState}`;
  const previousNotification = state?.pipelineNotification;

  if (terminal && previousNotification && previousNotification.status !== PIPELINE_NOTIFICATION_STATUS.DELIVERED) {
    throw new Error(`Issue #${issueId} has an unresolved terminal notification.`);
  }

  const registry = await readOptionalProjects(workspaceDir);
  const worker = findTransitionWorker(registry?.projects[project.slug], issueId) ?? state?.activeWorker ?? null;

  if (worker && state?.activeWorker && (worker.sessionKey !== state.activeWorker.sessionKey
    || worker.role !== state.activeWorker.role || worker.level !== state.activeWorker.level || worker.slotIndex !== state.activeWorker.slotIndex)) {
    throw new Error(`Issue #${issueId} has inconsistent worker ownership.`);
  }

  await input.beforeCommit?.();
  if (!issue.labels.includes(plan.toLabel)) await provider.transitionLabel(issueId, plan.from, plan.toLabel);
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
    pendingWorkerRelease: worker,
    pipelineNotification: terminal ? { eventKey, status: PIPELINE_NOTIFICATION_STATUS.PENDING, attemptedAt: new Date().toISOString() } : undefined,
    closedAt: input.closedAt,
  });
  await releaseTransitionWorkerLocked(workspaceDir, project.slug, issueId);
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
      workflow,
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
