import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import {
  findSlotByIssue,
  findStateByLabel,
  ISSUE_INTEGRITY_STATUS,
} from "../../domain/index.js";
import { loadConfig } from "../../state/config/index.js";
import {
  isIssueCreationReady,
  resolveIssueRuntimeState,
  withIssueOrchestrationLock,
  writeIssueRuntimeState,
} from "../../state/issues/index.js";
import { resolveProject, resolveProvider } from "../../tools/helpers.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import { resolveStartTaskDecision } from "./lifecycle-decision.js";

export type StartTaskInput = {
  workspaceDir: string;
  channelId: string;
  issueId: number;
  level?: string;
  runCommand: RunCommand;
};

export type StartTaskResult = {
  success: true;
  issueId: number;
  issueTitle: string;
  from: string;
  to: string;
  transitioned: boolean;
  level: string | null;
  project: string;
  announcement: string;
};

export async function startTask(input: StartTaskInput): Promise<StartTaskResult> {
  const { workspaceDir, channelId, issueId } = input;
  const { project } = await resolveProject(workspaceDir, channelId);

  return withIssueOrchestrationLock(workspaceDir, project.slug, issueId, () => startTaskLocked(input));
}

async function startTaskLocked(input: StartTaskInput): Promise<StartTaskResult> {
  const { workspaceDir, channelId, issueId, runCommand } = input;

  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);
  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const workflow = resolvedConfig.workflow;

  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({ workspaceDir, project, issue, workflow });

  if (runtimeState.kind !== "managed") {
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
    .some((roleWorker) => findSlotByIssue(roleWorker, String(issueId)) !== null);

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

  await provider.transitionLabel(issueId, decision.fromLabel, decision.targetLabel);

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
    owner: "task_start",
  });

  await auditLog(workspaceDir, "task_start", {
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
