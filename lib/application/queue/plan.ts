/** Plans local policy gating, role level, and free slot without I/O. */
import { findFreeSlot } from "../../domain/index.js";
import { resolveRoleLevel } from "../tasks/lifecycle-decision.js";
import type { QueuePickupDecision, QueuePickupPlanInput } from "./types.js";

/**
 * Select a concrete slot from fresh local state and resolved role configuration.
 * Provider labels do not influence review/test policy or the chosen level.
 * @param input - Candidate, configured role, and fresh role slot snapshot.
 */
export function planQueuePickup(input: QueuePickupPlanInput): QueuePickupDecision {
  const { issue, localState, role, roleConfig, worker } = input;

  if (role === "reviewer" && (localState.reviewPolicy === "human" || localState.reviewPolicy === "skip")) {
    return { kind: "blocked", reason: `review:${localState.reviewPolicy} policy` };
  }

  if (role === "tester" && localState.testPolicy === "skip") {
    return { kind: "blocked", reason: "test:skip policy" };
  }

  const level = resolveRoleLevel({
    runtimeState: localState,
    targetRole: role,
    roleConfig,
    issueTitle: issue.title,
    issueDescription: issue.description ?? "",
  });
  const slotIndex = findFreeSlot(worker, level);

  if (slotIndex === null) return { kind: "blocked", reason: `${level} slots full` };

  return {
    kind: "ready", level, slotIndex,
    sessionAction: worker.levels[level]?.[slotIndex]?.sessionKey ? "send" : "spawn",
  };
}
