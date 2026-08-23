/**
 * Queue service — workflow queue helpers.
 */
import {
  DEFAULT_WORKFLOW,
  STATE_TYPE,
  type WorkflowConfig,
} from "../../domain/index.js";

/**
 * Get state labels grouped by type from workflow config.
 * Returns { hold, active, queue } — terminal states excluded.
 */
export function getStateLabelsByType(
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): Record<"hold" | "active" | "queue", Array<{ label: string; role?: string; priority?: number }>> {
  const result: Record<"hold" | "active" | "queue", Array<{ label: string; role?: string; priority?: number }>> = {
    hold: [],
    active: [],
    queue: [],
  };

  for (const state of Object.values(workflow.states)) {
    const entry = { label: state.label, role: state.role, priority: state.priority };

    if (state.type === STATE_TYPE.HOLD) result.hold.push(entry);
    else if (state.type === STATE_TYPE.ACTIVE) result.active.push(entry);
    else if (state.type === STATE_TYPE.QUEUE) result.queue.push(entry);
  }

  result.queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return result;
}
