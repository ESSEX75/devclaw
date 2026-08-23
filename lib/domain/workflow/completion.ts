/**
 * workflow/completion.ts — Completion rules derived from workflow transitions.
 */
import { DEFAULT_RESULT_EMOJI, RESULT_EMOJI, STATE_TYPE } from "./const.js";
import { isCompletionResult } from "./guards.js";
import { findStateByLabel, findStateKeyByLabel, getActiveLabel } from "./queries.js";
import { type CompletionRule, type WorkflowDefinition, type WorkflowEvent } from "./types.js";

/**
 * Get completion rule for a role:result pair.
 * Derives entirely from workflow transitions — no hardcoded role:result mapping.
 */
export function getCompletionRule<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
  event: WorkflowEvent,
): CompletionRule<TLabel> | null {
  let activeLabel: TLabel;

  try {
    activeLabel = getActiveLabel(workflow, role);
  } catch { return null; }

  const activeKey = findStateKeyByLabel(workflow, activeLabel);

  if (!activeKey) return null;

  const activeState = workflow.states[activeKey];

  if (!activeState.on) return null;

  const transition = activeState.on[event];

  if (!transition) return null;

  const targetState = workflow.states[transition.target];

  if (!targetState) return null;

  return {
    from: activeLabel,
    to: targetState.label,
    actions: transition.actions ?? [],
  };
}

/**
 * Get human-readable next state description.
 */
export function getNextStateDescription<
  TRoleId extends string,
  TStateKey extends string,
  TLabel extends string,
>(
  workflow: WorkflowDefinition<TRoleId, TStateKey, TLabel>,
  role: TRoleId,
  event: WorkflowEvent,
): string {
  const rule = getCompletionRule(workflow, role, event);

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
  return isCompletionResult(result)
    ? RESULT_EMOJI[result]
    : DEFAULT_RESULT_EMOJI;
}
