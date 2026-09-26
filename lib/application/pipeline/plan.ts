/** Pure workflow queries for agent completion and heartbeat review transitions. */
import {
  type CompletionEventMap,
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

/** Resolve a merge-failure recovery destination, including the legacy To Improve fallback.
 * @param workflow - Validated runtime workflow.
 * @param fromLabel - Label from which merge failed.
 */
export function planMergeFailure(workflow: WorkflowConfig, fromLabel: string): TransitionPlan | null {
  const configured = planWorkflowEvent(workflow, fromLabel, WORKFLOW_EVENT.MERGE_FAILED);

  if (configured) return configured;
  const fallback = findStateByLabel(workflow, "To Improve");
  const key = fallback ? findStateKeyByLabel(workflow, fallback.label) : null;

  return fallback && key ? { from: fromLabel, toState: key, toLabel: fallback.label, actions: [] } : null;
}
