/** Plans local policy gating, role level, and free slot without I/O. */

import { findFreeSlot } from "../../domain/index.js";
import { resolveRoleLevel } from "../tasks/index.js";
import { WORKER_SESSION_ACTION } from "../workers/const.js";
import { QUEUE_PLAN, QUEUE_REASON } from "./const.js";
import { queuePolicyBlock } from "./policy.js";
import type { QueuePickupDecision, QueuePickupPlanInput } from "./types.js";

/**
 * Select a concrete slot from fresh local state and resolved role configuration.
 * Provider labels do not influence review/test policy or the chosen level.
 * @param input - Candidate, configured role, and fresh role slot snapshot.
 */
export function planQueuePickup(input: QueuePickupPlanInput): QueuePickupDecision {
  const { issue, localState, role, roleConfig, worker } = input;

  const policy = queuePolicyBlock(localState, role);

  if (policy) return { kind: QUEUE_PLAN.BLOCKED, code: policy, reason: "Saved issue policy excludes this worker role" };

  const level = resolveRoleLevel({
    runtimeState: localState,
    targetRole: role,
    roleConfig,
    issueTitle: issue.title,
    issueDescription: issue.description ?? "",
  });
  const slotIndex = findFreeSlot(worker, level);

  const capacity = roleConfig.levels[level]?.maxWorkers ?? 0;
  const activeCount = worker.levels[level]?.filter(slot => slot.active).length ?? 0;

  if (slotIndex === null || slotIndex >= capacity || activeCount >= capacity) {
    return { kind: QUEUE_PLAN.BLOCKED, code: QUEUE_REASON.CAPACITY, reason: `${level} slots full` };
  }

  return {
    kind: QUEUE_PLAN.READY, level, slotIndex,
    sessionAction: worker.levels[level]?.[slotIndex]?.sessionKey ? WORKER_SESSION_ACTION.SEND : WORKER_SESSION_ACTION.SPAWN,
  };
}
