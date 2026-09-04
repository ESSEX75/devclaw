import {
  isBuiltInRoleId,
  type IssueRuntimeState,
  STATE_TYPE,
  WORKFLOW_EVENT,
  type WorkflowConfig,
  type WorkflowStateConfig,
} from "../../domain/index.js";
import { selectLevel } from "../../roles/model-selector.js";
import type { ResolvedRoleConfig } from "../../state/config/index.js";

export type QueueTarget = {
  stateKey: string;
  state: WorkflowStateConfig & { type: typeof STATE_TYPE.QUEUE };
};

export type StartTaskDecision = {
  fromStateKey: string;
  fromLabel: string;
  targetStateKey: string;
  targetLabel: string;
  targetRole: string;
  assignedLevel: string;
};

export function resolveHoldQueueTarget(
  workflow: WorkflowConfig,
  currentState: WorkflowStateConfig,
): QueueTarget {
  if (currentState.type !== STATE_TYPE.HOLD) {
    throw new Error(`task_start only works on HOLD states. Current state is "${currentState.label}".`);
  }

  const approveTransition = currentState.on?.[WORKFLOW_EVENT.APPROVE];

  if (!approveTransition) {
    throw new Error(`HOLD state "${currentState.label}" has no APPROVE transition.`);
  }

  const targetState = workflow.states[approveTransition.target];

  if (!targetState) {
    throw new Error(`Transition target "${approveTransition.target}" not found in workflow.`);
  }

  if (targetState.type !== STATE_TYPE.QUEUE) {
    throw new Error(`Transition target "${approveTransition.target}" must be a queue state.`);
  }

  return { stateKey: approveTransition.target, state: targetState };
}

export function resolveRoleLevel(input: {
  requestedLevel?: string;
  runtimeState: IssueRuntimeState;
  targetRole: string;
  roleConfig: ResolvedRoleConfig;
  issueTitle: string;
  issueDescription: string;
}): string {
  const { requestedLevel, runtimeState, targetRole, roleConfig } = input;

  if (!roleConfig.enabled) {
    throw new Error(`Role "${targetRole}" is disabled.`);
  }

  if (requestedLevel !== undefined) {
    validateRoleLevel(targetRole, requestedLevel, roleConfig);

    return requestedLevel;
  }

  if (
    runtimeState.assignedRole === targetRole
    && runtimeState.assignedLevel
    && roleConfig.levels.includes(runtimeState.assignedLevel)
  ) {
    return runtimeState.assignedLevel;
  }

  const selectedLevel = isBuiltInRoleId(targetRole)
    ? selectLevel(input.issueTitle, input.issueDescription, targetRole).level
    : roleConfig.defaultLevel;

  validateRoleLevel(targetRole, selectedLevel, roleConfig);

  return selectedLevel;
}

export function validateRoleLevel(
  role: string,
  level: string,
  roleConfig: ResolvedRoleConfig,
): void {
  if (!roleConfig.levels.includes(level)) {
    throw new Error(`Invalid level "${level}" for role "${role}". Valid: ${roleConfig.levels.join(", ")}`);
  }
}

export function resolveStartTaskDecision(input: {
  workflow: WorkflowConfig;
  currentState: WorkflowStateConfig;
  runtimeState: IssueRuntimeState;
  roles: Readonly<Record<string, ResolvedRoleConfig>>;
  requestedLevel?: string;
  issueTitle: string;
  issueDescription: string;
}): StartTaskDecision {
  const target = resolveHoldQueueTarget(input.workflow, input.currentState);
  const targetRole = target.state.role;
  const roleConfig = input.roles[targetRole];

  if (!roleConfig) throw new Error(`Target role "${targetRole}" is not configured.`);

  return {
    fromStateKey: input.runtimeState.workflowState,
    fromLabel: input.runtimeState.workflowLabel,
    targetStateKey: target.stateKey,
    targetLabel: target.state.label,
    targetRole,
    assignedLevel: resolveRoleLevel({
      requestedLevel: input.requestedLevel,
      runtimeState: input.runtimeState,
      targetRole,
      roleConfig,
      issueTitle: input.issueTitle,
      issueDescription: input.issueDescription,
    }),
  };
}
