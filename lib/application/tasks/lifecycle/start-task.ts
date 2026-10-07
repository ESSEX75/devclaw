/** Owns a managed task lifecycle operation or its pure transition decision. */

import { log as auditLog } from "../../../audit.js";
import {
  findSlotByIssue,
  findStateByLabel,
  ISSUE_INTEGRITY_STATUS,
} from "../../../domain/index.js";
import { isIssueCreationReady, loadConfig, withIssueOrchestrationLock } from "../../../state/index.js";
import { ISSUE_RUNTIME_KIND } from "../../issue-runtime/const.js";
import { resolveIssueRuntimeState, writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { transitionWorkflowLabel } from "../../projection/index.js";
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import { resolveProject, resolveProvider } from "../../projects/index.js";
import { TASK_EVENT } from "./const.js";
import { resolveStartTaskDecision } from "./lifecycle-decision.js";
import type { StartTaskInput, StartTaskResult } from "./types.js";

/** Serialize approval of a held task with other lifecycle commands.
 * @param input - Validated command dependencies and requested changes.
 */
export async function startTask(input: StartTaskInput): Promise<StartTaskResult> {
  const { workspaceDir, channelId, issueId } = input;
  const { project } = await resolveProject(workspaceDir, channelId);

  return withIssueOrchestrationLock(workspaceDir, project.slug, issueId, () => startTaskLocked(input));
}

/** Validate fresh state and commit the configured approval transition.
 * @param input - Validated command dependencies and requested changes.
 */
async function startTaskLocked(input: StartTaskInput): Promise<StartTaskResult> {
  const { workspaceDir, channelId, issueId, runCommand } = input;

  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);
  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const workflow = resolvedConfig.workflow;

  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({ workspaceDir, project, issue, workflow });

  if (runtimeState.kind !== ISSUE_RUNTIME_KIND.MANAGED) {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_start.`);
  }

  if (!await isIssueCreationReady(workspaceDir, project.slug, runtimeState.state.creationOperationId)) {
    throw new Error(`Issue #${issueId} creation is not ready. Wait for creation reconciliation before task_start.`);
  }

  if (runtimeState.state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${issueId} has integrity_error. Repair local state before task_start.`);
  }

  if (runtimeState.state.activeWorker) {
    throw new Error(`Issue #${issueId} already has an active worker.`);
  }

  const issueSlot = Object.values(project.workers)
    .some((roleWorker) => findSlotByIssue(roleWorker, issueId) !== null);

  if (issueSlot) {
    throw new Error(`Issue #${issueId} is already assigned to a worker slot.`);
  }

  const currentLabel = runtimeState.workflowLabel;
  const currentState = runtimeState.stateConfig ?? findStateByLabel(workflow, currentLabel);

  if (!currentState) {
    throw new Error(`No state config for label "${currentLabel}".`);
  }

  const decision = resolveStartTaskDecision({
    workflow,
    currentState,
    runtimeState: runtimeState.state,
    roles: resolvedConfig.roles,
    requestedLevel: input.level,
    issueTitle: issue.title,
    issueDescription: issue.description ?? "",
  });

  await transitionWorkflowLabel(provider, workflow, issueId, decision.fromLabel, decision.targetLabel);

  const configuredRoleIds = Object.keys(resolvedConfig.roles);
  const nextLabels = issue.labels
    .filter((candidate) => candidate !== decision.fromLabel)
    .filter((candidate) => !configuredRoleIds.some((role) => candidate.startsWith(`${role}:`)))
    .concat(decision.targetLabel, `${decision.targetRole}:${decision.assignedLevel}`);

  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: { ...issue, labels: nextLabels },
    providerType,
    workflow,
    workflowLabel: decision.targetLabel,
    workflowState: decision.targetStateKey,
    assignedRole: decision.targetRole,
    assignedLevel: decision.assignedLevel,
  });

  await reconcileManagedLabelsLocked({
    workspaceDir,
    projectSlug: project.slug,
    issueId,
    workflow,
    roles: configuredRoleIds,
    provider,
    owner: TASK_EVENT.START,
  });

  await auditLog(workspaceDir, TASK_EVENT.START, {
    project: project.name, issueId,
    from: decision.fromLabel, to: decision.targetLabel,
    transitioned: true, level: decision.assignedLevel,
  });

  const announcement = `▶️ #${issueId} moved to "${decision.targetLabel}" `
    + `(level: ${decision.assignedLevel}) — heartbeat will dispatch.`;

  return {
    success: true, issueId, issueTitle: issue.title,
    from: decision.fromLabel, to: decision.targetLabel, transitioned: true,
    level: decision.assignedLevel,
    project: project.name, announcement,
  };
}
