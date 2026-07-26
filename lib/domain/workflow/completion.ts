/**
 * workflow/completion.ts — Completion rules derived from workflow transitions.
 */
import { DEFAULT_RESULT_EMOJI, RESULT_EMOJI, STATE_TYPE, WORKFLOW_EVENT } from "./const.js";
import { isWorkflowEvent } from "./guards.js";
import { findStateByLabel, findStateKeyByLabel, getActiveLabel } from "./queries.js";
import { getTransitionTargetKey } from "./transitions.js";
import { type CompletionRule, type RoleId, type WorkflowConfig, type WorkflowEvent, type WorkflowLabel } from "./types.js";

/**
 * Map completion result to workflow transition event name.
 * Convention: "done" → COMPLETE, others → uppercase.
 */
function resultToEvent(result: string): WorkflowEvent | null {
  if (result === "done") return WORKFLOW_EVENT.COMPLETE;

  const event = result.toUpperCase();

  return isWorkflowEvent(event) ? event : null;
}

/**
 * Get completion rule for a role:result pair.
 * Derives entirely from workflow transitions — no hardcoded role:result mapping.
 */
export function getCompletionRule(
  workflow: WorkflowConfig,
  role: RoleId,
  result: string,
): CompletionRule | null {
  const event = resultToEvent(result);

  if (!event) return null;

  let activeLabel: WorkflowLabel;

  try {
    activeLabel = getActiveLabel(workflow, role);
  } catch { return null; }

  const activeKey = findStateKeyByLabel(workflow, activeLabel);

  if (!activeKey) return null;

  const activeState = workflow.states[activeKey];

  if (!activeState.on) return null;

  const transition = activeState.on[event];

  if (!transition) return null;

  const targetKey = getTransitionTargetKey(transition);
  const actions = typeof transition === "object" ? transition.actions : undefined;
  const targetState = workflow.states[targetKey];

  if (!targetState) return null;

  return {
    from: activeLabel,
    to: targetState.label,
    actions: actions ?? [],
  };
}

/**
 * Get human-readable next state description.
 */
export function getNextStateDescription(
  workflow: WorkflowConfig,
  role: RoleId,
  result: string,
): string {
  const rule = getCompletionRule(workflow, role, result);

  if (!rule) return "";

  const targetState = findStateByLabel(workflow, rule.to);

  if (!targetState) return "";

  if (targetState.type === STATE_TYPE.TERMINAL) return "Done!";
  if (targetState.type === STATE_TYPE.HOLD) return "awaiting human decision";
  if (targetState.type === STATE_TYPE.QUEUE && targetState.role) {
    return `${targetState.role.toUpperCase()} queue`;
  }

  return rule.to;
}

/** Get emoji for a completion result. */
export function getCompletionEmoji(result: string): string {
  switch (result) {
    case "done":
      return RESULT_EMOJI.DONE;
    case "pass":
      return RESULT_EMOJI.PASS;
    case "fail":
      return RESULT_EMOJI.FAIL;
    case "refine":
      return RESULT_EMOJI.REFINE;
    case "blocked":
      return RESULT_EMOJI.BLOCKED;
    case "approve":
      return RESULT_EMOJI.APPROVE;
    case "reject":
      return RESULT_EMOJI.REJECT;
    default:
      return DEFAULT_RESULT_EMOJI;
  }
}
