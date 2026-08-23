import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import {
  findStateByLabel,
  getRoleLabelColor,
  STATE_TYPE,
  WORKFLOW_EVENT,
  type WorkflowConfig,
  type WorkflowStateConfig,
} from "../../domain/index.js";
import { loadConfig } from "../../state/config/index.js";
import { detectNotifyTarget, resolveIssueRuntimeState, writeIssueRuntimeState } from "../../state/issues/index.js";
import { applyNotifyLabel,autoAssignOwnerLabel, resolveProject, resolveProvider } from "../../tools/helpers.js";

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
  const { workspaceDir, channelId, issueId, runCommand } = input;
  const levelHint = input.level;
  let assignedLevel: string | undefined;

  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);
  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const workflow = resolvedConfig.workflow;

  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({ workspaceDir, project, issue, workflow });

  if (runtimeState.kind !== "managed") {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_start.`);
  }

  const currentLabel = runtimeState.workflowLabel;
  const currentState = runtimeState.stateConfig ?? findStateByLabel(workflow, currentLabel);

  if (!currentState) {
    throw new Error(`No state config for label "${currentLabel}".`);
  }

  const { targetLabel, targetState, transitioned } = resolveStartTarget(
    workflow, currentLabel, currentState,
  );

  if (transitioned) {
    await provider.transitionLabel(issueId, currentLabel, targetLabel);
  }

  const targetRole = targetState.role;

  if (levelHint && targetRole) {
    const validLevels = resolvedConfig.roles[targetRole]?.levels ?? [];

    if (!validLevels.includes(levelHint)) {
      throw new Error(`Invalid level "${levelHint}" for role "${targetRole}". Valid: ${validLevels.join(", ")}`);
    }

    assignedLevel = levelHint;

    const oldRoleLabels = issue.labels.filter((l) => l.startsWith(`${targetRole}:`));

    if (oldRoleLabels.length > 0) {
      await provider.removeLabels(issueId, oldRoleLabels);
    }

    const hintLabel = `${targetRole}:${levelHint}`;

    await provider.ensureLabel(hintLabel, getRoleLabelColor(targetRole));
    await provider.addLabel(issueId, hintLabel);
  }

  applyNotifyLabel(provider, issueId, project, channelId, issue.labels);
  autoAssignOwnerLabel(workspaceDir, provider, issueId, project).catch(() => {});

  const nextLabels = issue.labels
    .filter((candidate) => candidate !== currentLabel && !candidate.startsWith(`${targetRole}:`))
    .concat(targetLabel);

  if (levelHint && targetRole) nextLabels.push(`${targetRole}:${levelHint}`);
  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: { ...issue, labels: nextLabels },
    providerType,
    workflow,
    workflowLabel: targetLabel,
    assignedRole: targetRole ?? null,
    assignedLevel,
    notifyTarget: detectNotifyTarget(nextLabels, project.channels),
  });

  await auditLog(workspaceDir, "task_start", {
    project: project.name, issueId,
    from: currentLabel, to: targetLabel,
    transitioned, level: levelHint ?? null,
  });

  const levelMsg = levelHint ? ` (level hint: ${levelHint})` : "";
  const announcement = transitioned
    ? `▶️ #${issueId} moved to "${targetLabel}"${levelMsg} — heartbeat will dispatch.`
    : `▶️ #${issueId} already in queue "${targetLabel}"${levelMsg} — heartbeat will dispatch.`;

  return {
    success: true, issueId, issueTitle: issue.title,
    from: currentLabel, to: targetLabel, transitioned,
    level: levelHint ?? null,
    project: project.name, announcement,
  };
}

export function resolveStartTarget(
  workflow: WorkflowConfig,
  currentLabel: string,
  currentState: WorkflowStateConfig,
): { targetLabel: string; targetState: WorkflowStateConfig; transitioned: boolean } {
  switch (currentState.type) {
    case STATE_TYPE.HOLD: {
      const approveTransition = currentState.on?.[WORKFLOW_EVENT.APPROVE];

      if (!approveTransition) {
        throw new Error(`HOLD state "${currentLabel}" has no APPROVE transition.`);
      }

      const targetKey = approveTransition.target;
      const targetState = workflow.states[targetKey];

      if (!targetState) {
        throw new Error(`Transition target "${targetKey}" not found in workflow.`);
      }

      return { targetLabel: targetState.label, targetState, transitioned: true };
    }

    case STATE_TYPE.QUEUE:
      return { targetLabel: currentLabel, targetState: currentState, transitioned: false };
    case STATE_TYPE.ACTIVE:
      throw new Error(`Issue is in active state "${currentLabel}" — already being worked on.`);
    case STATE_TYPE.TERMINAL:
      throw new Error(`Issue is in terminal state "${currentLabel}" — cannot start.`);
    default:
      throw new Error(`Unknown state type for "${currentLabel}".`);
  }
}
