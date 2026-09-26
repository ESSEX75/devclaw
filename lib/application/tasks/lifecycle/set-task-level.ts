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
import { reconcileManagedLabelsLocked } from "../../projection/index.js";
import { resolveProject, resolveProvider } from "../../projects/index.js";
import { TASK_EVENT } from "./const.js";
import { resolveHoldQueueTarget, validateRoleLevel } from "./lifecycle-decision.js";
import type { SetTaskLevelInput, SetTaskLevelResult } from "./types.js";

/** Serialize an explicit level change with issue lifecycle transitions.
 * @param input - Validated command dependencies and requested changes.
 */
export async function setTaskLevel(input: SetTaskLevelInput): Promise<SetTaskLevelResult> {
  const { project } = await resolveProject(input.workspaceDir, input.channelId);

  return withIssueOrchestrationLock(
    input.workspaceDir,
    project.slug,
    input.issueId,
    () => setTaskLevelLocked(input),
  );
}

/** Recheck creation, integrity, and worker ownership before preparing an assignment.
 * @param input - Validated command dependencies and requested changes.
 */
async function setTaskLevelLocked(input: SetTaskLevelInput): Promise<SetTaskLevelResult> {
  const { workspaceDir, channelId, issueId, level, runCommand } = input;
  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);
  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({
    workspaceDir,
    project,
    issue,
    workflow: resolvedConfig.workflow,
  });

  if (runtimeState.kind !== ISSUE_RUNTIME_KIND.MANAGED) {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_set_level.`);
  }

  if (!await isIssueCreationReady(workspaceDir, project.slug, runtimeState.state.creationOperationId)) {
    throw new Error(`Issue #${issueId} creation is not ready. Wait for creation reconciliation before task_set_level.`);
  }

  if (runtimeState.state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${issueId} has integrity_error. Repair local state before task_set_level.`);
  }

  if (runtimeState.state.activeWorker) {
    throw new Error(`Issue #${issueId} already has an active worker.`);
  }

  const issueSlot = Object.values(project.workers)
    .some((roleWorker) => findSlotByIssue(roleWorker, issueId) !== null);

  if (issueSlot) throw new Error(`Issue #${issueId} is already assigned to a worker slot.`);

  const currentState = runtimeState.stateConfig
    ?? findStateByLabel(resolvedConfig.workflow, runtimeState.workflowLabel);

  if (!currentState) throw new Error(`No state config for label "${runtimeState.workflowLabel}".`);

  const target = resolveHoldQueueTarget(resolvedConfig.workflow, currentState);
  const role = target.state.role;
  const roleConfig = resolvedConfig.roles[role];

  if (!roleConfig) throw new Error(`Target role "${role}" is not configured.`);
  if (!roleConfig.enabled) throw new Error(`Role "${role}" is disabled.`);

  validateRoleLevel(role, level, roleConfig);

  const fromLevel = runtimeState.state.assignedRole === role
    ? runtimeState.state.assignedLevel ?? null
    : null;
  const changed = runtimeState.state.assignedRole !== role || fromLevel !== level;
  const configuredRoleIds = Object.keys(resolvedConfig.roles);
  const nextLabels = issue.labels
    .filter((label) => !configuredRoleIds.some((roleId) => label.startsWith(`${roleId}:`)))
    .concat(`${role}:${level}`);

  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: { ...issue, labels: nextLabels },
    providerType,
    workflow: resolvedConfig.workflow,
    workflowLabel: runtimeState.workflowLabel,
    workflowState: runtimeState.workflowState,
    assignedRole: role,
    assignedLevel: level,
  });

  await reconcileManagedLabelsLocked({
    workspaceDir,
    projectSlug: project.slug,
    issueId,
    workflow: resolvedConfig.workflow,
    roles: configuredRoleIds,
    provider,
    owner: TASK_EVENT.SET_LEVEL,
  });

  await auditLog(workspaceDir, TASK_EVENT.SET_LEVEL, {
    project: project.name,
    issueId,
    ...(changed ? { fromLevel, toLevel: level } : {}),
    reason: input.reason ?? null,
    provider: providerType,
  });

  return {
    success: true,
    issueId,
    issueTitle: issue.title,
    level,
    changed,
    project: project.name,
    provider: providerType,
    announcement: changed
      ? `🔄 Updated #${issueId}: level ${fromLevel ?? "none"} → ${level}${input.reason ? ` (${input.reason})` : ""}`
      : `Issue #${issueId} already has level "${level}".`,
  };
}
