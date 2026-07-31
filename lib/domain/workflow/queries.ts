/**
 * workflow/queries.ts — Pure query functions over workflow configuration.
 */
import { DEFAULT_ROLES, STATE_TYPE, WORKFLOW_EVENT } from "./const.js";
import { isWorkflowEvent } from "./guards.js";
import { type StateDefinition, type WorkflowDefinition, type WorkflowEvent } from "./types.js";

/** Return workflow states without losing generic identifier types. */
function getWorkflowStates<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
): Array<StateDefinition<TRoleId, TStateKey, TLabel>> {
  const states: Array<StateDefinition<TRoleId, TStateKey, TLabel>> = [];

  for (const stateKey in workflow.states) {
    states.push(workflow.states[stateKey]);
  }

  return states;
}

/**
 * Get all state labels (for GitHub/GitLab label creation).
 */
export function getStateLabels<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>): TLabel[] {
  return getWorkflowStates(workflow).map((state) => state.label);
}

/**
 * Find the current workflow state label on an issue.
 * Pure utility — no provider dependency.
 */
export function getCurrentStateLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  labels: readonly string[],
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
): TLabel | null {
  for (const state of getWorkflowStates(workflow)) {
    if (labels.includes(state.label)) return state.label;
  }

  return null;
}

/**
 * Get the initial state label (the first state in the workflow, e.g. "Planning").
 */
export function getInitialStateLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>): TLabel {
  return workflow.states[workflow.initial].label;
}

/**
 * Get label → color mapping.
 */
export function getLabelColors<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>): ReadonlyMap<TLabel, string> {
  const colors = new Map<TLabel, string>();

  for (const state of getWorkflowStates(workflow)) {
    colors.set(state.label, state.color);
  }

  return colors;
}

/**
 * Get queue labels for a role, ordered by priority (highest first).
 */
export function getQueueLabels<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): TLabel[] {
  return getWorkflowStates(workflow)
    .filter((s) => s.type === STATE_TYPE.QUEUE && s.role === role)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get all queue labels ordered by priority (for findNextIssue).
 */
export function getAllQueueLabels<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>): TLabel[] {
  return getWorkflowStates(workflow)
    .filter((s) => s.type === STATE_TYPE.QUEUE)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get the active (in-progress) label for a role.
 */
export function getActiveLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): TLabel {
  const state = getWorkflowStates(workflow).find(
    (s) => s.type === STATE_TYPE.ACTIVE && s.role === role,
  );

  if (!state) throw new Error(`No active state for role "${role}"`);

  return state.label;
}

/**
 * Get the revert label for a role (first queue state for that role).
 */
export function getRevertLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): TLabel {
  const activeLabel = getActiveLabel(workflow, role);
  const activeStateKey = findStateKeyByLabel(workflow, activeLabel);

  for (const state of getWorkflowStates(workflow)) {
    if (state.type !== STATE_TYPE.QUEUE || state.role !== role) continue;
    const pickup = state.on?.[WORKFLOW_EVENT.PICKUP];

    if (pickup?.target === activeStateKey) {
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
export function detectRoleFromLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  label: string,
): TRoleId | null {
  for (const state of getWorkflowStates(workflow)) {
    if (state.label === label && state.type === STATE_TYPE.QUEUE && state.role) {
      return state.role;
    }
  }

  return null;
}


/**
 * Find state config by label.
 */
export function findStateByLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  label: string,
): StateDefinition<TRoleId, TStateKey, TLabel> | null {
  return getWorkflowStates(workflow).find((state) => state.label === label) ?? null;
}

/**
 * Find state key by label.
 */
export function findStateKeyByLabel<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  label: string,
): TStateKey | null {
  for (const stateKey in workflow.states) {
    if (workflow.states[stateKey].label === label) return stateKey;
  }

  return null;
}

/**
 * Check if a role has any workflow states (queue, active, etc.).
 */
export function hasWorkflowStates<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): boolean {
  return getWorkflowStates(workflow).some((state) => state.role === role);
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
export function isFeedbackState<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  label: string,
): boolean {
  const stateKey = findStateKeyByLabel(workflow, label);

  if (!stateKey) return false;
  for (const state of getWorkflowStates(workflow)) {
    if (!state.on) continue;
    for (const [event, transition] of Object.entries(state.on)) {
      if (!isWorkflowEvent(event)) continue;

      if (transition.target === stateKey && FEEDBACK_EVENTS.has(event)) return true;
    }
  }

  return false;
}

/**
 * Check if a role has states with PR review checks (e.g. prApproved, prMerged).
 */
export function hasReviewCheck<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): boolean {
  return getWorkflowStates(workflow).some(
    (s) => s.role === role && s.check != null,
  );
}

/**
 * Check if completing this role's active state leads to a state with a review check.
 */
export function producesReviewableWork<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
): boolean {
  let activeKey: TStateKey | null;

  try {
    const activeLabel = getActiveLabel(workflow, role);

    activeKey = findStateKeyByLabel(workflow, activeLabel);
  } catch { return false; }

  if (!activeKey) return false;

  const activeState = workflow.states[activeKey];

  if (!activeState.on) return false;

  for (const transition of Object.values(activeState.on)) {
    const targetState = workflow.states[transition.target];

    if (targetState?.check != null) return true;
  }

  return false;
}

/**
 * Check if the workflow has a test phase (any queue state with role=tester).
 */
export function hasTestPhase<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>): boolean {
  return getWorkflowStates(workflow).some(
    (s) => s.role === DEFAULT_ROLES.TESTER && s.type === STATE_TYPE.QUEUE,
  );
}
