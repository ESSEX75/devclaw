/** Pure workflow queries for agent completion and heartbeat review transitions. */

import {
  type CompletionEventMap,
  type CompletionRule,
  DEFAULT_WORKFLOW,
  findStateByLabel,
  findStateKeyByLabel,
  getCompletionRule,
  getNextStateDescription,
  WORKFLOW_EVENT,
  type WorkflowConfig,
  type WorkflowEvent,
} from "../../domain/index.js";
import type { CompletionPlan, TransitionPlan } from "./types.js";

/** Resolve a configured event without restricting custom state keys or labels.
 * @param workflow - Validated runtime workflow.
 * @param fromLabel - Current workflow label.
 * @param event - Event to resolve from the current state.
 */
export function planWorkflowEvent(workflow: WorkflowConfig, fromLabel: string, event: WorkflowEvent): TransitionPlan | null {
  const state = findStateByLabel(workflow, fromLabel);
  const target = state?.on?.[event];

  if (!target) return null;
  const next = workflow.states[target.target];

  if (!next) return null;

  return { from: fromLabel, toState: target.target, toLabel: next.label, actions: target.actions ?? [] };
}

/** Validate a role result and resolve its complete transition before effects.
 * @param workflow - Validated runtime workflow.
 * @param role - Configured role identifier.
 * @param result - Configured result identifier.
 * @param completion - Role-specific result-to-event mapping.
 */
export function planCompletion(workflow: WorkflowConfig, role: string, result: string, completion: CompletionEventMap): CompletionPlan {
  const event = completion[result];

  if (!event) throw new Error(`No completion event configured for ${role}:${result}`);
  const rule = getCompletionRule(workflow, role, event);

  if (!rule) throw new Error(`No completion rule for ${role}:${result}`);
  const toState = findStateKeyByLabel(workflow, rule.to);

  if (!toState) throw new Error(`No target state for ${role}:${result}`);

  return {
    event,
    rule,
    transition: { from: rule.from, toState, toLabel: rule.to, actions: rule.actions },
    nextState: getNextStateDescription(workflow, role, event),
  };
}

/** Resolve only the explicitly configured merge-failure recovery destination.
 * @param workflow - Validated runtime workflow.
 * @param fromLabel - Label from which merge failed.
 */
export function planMergeFailure(workflow: WorkflowConfig, fromLabel: string): TransitionPlan | null {
  return planWorkflowEvent(workflow, fromLabel, WORKFLOW_EVENT.MERGE_FAILED);
}

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 * @param role - Configured completing role.
 * @param result - Configured role result.
 * @param completion - Result-to-event mapping.
 * @param workflow - Resolved workflow, or built-in defaults.
 */
export function getRule(
  role: string,
  result: string,
  completion: CompletionEventMap,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule<string> | undefined {
  const event = completion[result];

  return event
    ? getCompletionRule(workflow, role, event) ?? undefined
    : undefined;
}
