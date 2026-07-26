/**
 * workflow/transitions.ts — Pure helpers for workflow transition targets.
 */
import type { TransitionTarget, WorkflowStateKey } from "./types.js";

/** Return the destination state key from either transition target representation. */
export function getTransitionTargetKey(transition: TransitionTarget): WorkflowStateKey {
  return typeof transition === "string" ? transition : transition.target;
}
