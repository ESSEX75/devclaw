import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import {
  findSlotByIssue,
  findStateByLabel,
  getRoleLabelColor,
  ISSUE_INTEGRITY_STATUS,
} from "../../domain/index.js";
import { loadConfig } from "../../state/config/index.js";
import { resolveIssueRuntimeState, writeIssueRuntimeState } from "../../state/issues/index.js";
import { resolveProject, resolveProvider } from "../../tools/helpers.js";
import { resolveHoldQueueTarget, validateRoleLevel } from "./lifecycle-decision.js";

export type SetTaskLevelInput = {
  workspaceDir: string;
  channelId: string;
  issueId: number;
  level: string;
  reason?: string;
  runCommand: RunCommand;
};

export type SetTaskLevelResult = {
  success: true;
  issueId: number;
  issueTitle: string;
  level: string;
  changed: boolean;
  project: string;
  provider: string;
  announcement: string;
};

export async function setTaskLevel(input: SetTaskLevelInput): Promise<SetTaskLevelResult> {
  const { workspaceDir, channelId, issueId, level, runCommand } = input;
  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);
  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({
    workspaceDir,
    project,
    issue,
    workflow: resolvedConfig.workflow,
  });

  if (runtimeState.kind !== "managed") {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_set_level.`);
  }

  if (runtimeState.state.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${issueId} has integrity_error. Repair local state before task_set_level.`);
  }

  if (runtimeState.state.activeWorker) {
    throw new Error(`Issue #${issueId} already has an active worker.`);
  }

  const issueSlot = Object.values(project.workers)
    .some((roleWorker) => findSlotByIssue(roleWorker, String(issueId)) !== null);

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

  const oldRoleLabels = issue.labels
    .filter((label) => configuredRoleIds.some((roleId) => label.startsWith(`${roleId}:`)));

  if (oldRoleLabels.length > 0) await provider.removeLabels(issueId, oldRoleLabels);

  const roleLabel = `${role}:${level}`;

  await provider.ensureLabel(roleLabel, getRoleLabelColor(role));
  await provider.addLabel(issueId, roleLabel);

  await auditLog(workspaceDir, "task_set_level", {
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
