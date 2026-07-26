/**
 * workflow/queries.ts — Pure query functions over workflow configuration.
 */
import { DEFAULT_ROLES, STATE_TYPE, WORKFLOW_EVENT } from "./const.js";
import { isWorkflowEvent, isWorkflowStateKey } from "./guards.js";
import { getTransitionTargetKey } from "./transitions.js";
import { type RoleId, type StateConfig, type WorkflowConfig, type WorkflowEvent, type WorkflowLabel, type WorkflowStateKey } from "./types.js";

/**
 * Get all state labels (for GitHub/GitLab label creation).
 */
export function getStateLabels(workflow: WorkflowConfig): WorkflowLabel[] {
  return Object.values(workflow.states).map((s) => s.label);
}

/**
 * Find the current workflow state label on an issue.
 * Pure utility — no provider dependency.
 */
export function getCurrentStateLabel(labels: readonly string[], workflow: WorkflowConfig): WorkflowLabel | null {
  for (const state of Object.values(workflow.states)) {
    if (labels.includes(state.label)) return state.label;
  }

  return null;
}

/**
 * Get the initial state label (the first state in the workflow, e.g. "Planning").
 */
export function getInitialStateLabel(workflow: WorkflowConfig): WorkflowLabel {
  return workflow.states[workflow.initial].label;
}

/**
 * Get label → color mapping.
 */
export function getLabelColors(workflow: WorkflowConfig): ReadonlyMap<WorkflowLabel, string> {
  const colors = new Map<WorkflowLabel, string>();

  for (const state of Object.values(workflow.states)) {
    colors.set(state.label, state.color);
  }

  return colors;
}

/**
 * Get queue labels for a role, ordered by priority (highest first).
 */
export function getQueueLabels(workflow: WorkflowConfig, role: RoleId): WorkflowLabel[] {
  return Object.values(workflow.states)
    .filter((s) => s.type === STATE_TYPE.QUEUE && s.role === role)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get all queue labels ordered by priority (for findNextIssue).
 */
export function getAllQueueLabels(workflow: WorkflowConfig): WorkflowLabel[] {
  return Object.values(workflow.states)
    .filter((s) => s.type === STATE_TYPE.QUEUE)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get the active (in-progress) label for a role.
 */
export function getActiveLabel(workflow: WorkflowConfig, role: RoleId): WorkflowLabel {
  const state = Object.values(workflow.states).find(
    (s) => s.type === STATE_TYPE.ACTIVE && s.role === role,
  );

  if (!state) throw new Error(`No active state for role "${role}"`);

  return state.label;
}

/**
 * Get the revert label for a role (first queue state for that role).
 */
export function getRevertLabel(workflow: WorkflowConfig, role: RoleId): WorkflowLabel {
  const activeLabel = getActiveLabel(workflow, role);
  const activeStateKey = Object.entries(workflow.states).find(
    ([, s]) => s.label === activeLabel,
  )?.[0];

  for (const [, state] of Object.entries(workflow.states)) {
    if (state.type !== STATE_TYPE.QUEUE || state.role !== role) continue;
    const pickup = state.on?.[WORKFLOW_EVENT.PICKUP];

    if (pickup && getTransitionTargetKey(pickup) === activeStateKey) {
      return state.label;
    }
  }

  const queueLabel = getQueueLabels(workflow, role)[0];

  if (!queueLabel) throw new Error(`No queue state for role "${role}"`);

  return queueLabel;
}

/**
 * Detect role from a label.
 */
export function detectRoleFromLabel(workflow: WorkflowConfig, label: string): RoleId | null {
  for (const state of Object.values(workflow.states)) {
    if (state.label === label && state.type === STATE_TYPE.QUEUE && state.role) {
      return state.role;
    }
  }

  return null;
}


/**
 * Find state config by label.
 */
export function findStateByLabel(workflow: WorkflowConfig, label: string): StateConfig | null {
  return Object.values(workflow.states).find((s) => s.label === label) ?? null;
}

/**
 * Find state key by label.
 */
export function findStateKeyByLabel(workflow: WorkflowConfig, label: string): WorkflowStateKey | null {
  const stateKey = Object.entries(workflow.states).find(([, state]) => state.label === label)?.[0];

  return stateKey && isWorkflowStateKey(stateKey) ? stateKey : null;
}

/**
 * Check if a role has any workflow states (queue, active, etc.).
 */
export function hasWorkflowStates(workflow: WorkflowConfig, role: RoleId): boolean {
  return Object.values(workflow.states).some((s) => s.role === role);
}

/** Workflow events that indicate review/test feedback. */
const FEEDBACK_EVENTS: Set<WorkflowEvent> = new Set([
  WORKFLOW_EVENT.CHANGES_REQUESTED,
  WORKFLOW_EVENT.MERGE_CONFLICT,
  WORKFLOW_EVENT.MERGE_FAILED,
  WORKFLOW_EVENT.REJECT,
  WORKFLOW_EVENT.FAIL,
  WORKFLOW_EVENT.PR_CLOSED,
]);

/**
 * Check if a label's state is a "feedback" state — one that issues land in
 * after review rejection, test failure, or merge conflict.
 */
export function isFeedbackState(workflow: WorkflowConfig, label: string): boolean {
  const stateKey = findStateKeyByLabel(workflow, label);

  if (!stateKey) return false;
  for (const state of Object.values(workflow.states)) {
    if (!state.on) continue;
    for (const [event, transition] of Object.entries(state.on)) {
      if (!isWorkflowEvent(event)) continue;

      const targetKey = getTransitionTargetKey(transition);

      if (targetKey === stateKey && FEEDBACK_EVENTS.has(event)) return true;
    }
  }

  return false;
}

/**
 * Check if a role has states with PR review checks (e.g. prApproved, prMerged).
 */
export function hasReviewCheck(workflow: WorkflowConfig, role: RoleId): boolean {
  return Object.values(workflow.states).some(
    (s) => s.role === role && s.check != null,
  );
}

/**
 * Check if completing this role's active state leads to a state with a review check.
 */
export function producesReviewableWork(workflow: WorkflowConfig, role: RoleId): boolean {
  let activeKey: WorkflowStateKey | null;

  try {
    const activeLabel = getActiveLabel(workflow, role);

    activeKey = findStateKeyByLabel(workflow, activeLabel);
  } catch { return false; }

  if (!activeKey) return false;

  const activeState = workflow.states[activeKey];

  if (!activeState.on) return false;

  for (const transition of Object.values(activeState.on)) {
    const targetKey = getTransitionTargetKey(transition);
    const targetState = workflow.states[targetKey];

    if (targetState?.check != null) return true;
  }

  return false;
}

/**
 * Check if the workflow has a test phase (any queue state with role=tester).
 */
export function hasTestPhase(workflow: WorkflowConfig): boolean {
  return Object.values(workflow.states).some(
    (s) => s.role === DEFAULT_ROLES.TESTER && s.type === STATE_TYPE.QUEUE,
  );
}
