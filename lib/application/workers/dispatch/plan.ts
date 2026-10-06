/** Computes worker session identity and model without I/O or state mutation. */

import { formatWorkerSessionKey } from "../../../integrations/openclaw/session-identity.js";
import { slotName } from "../../../names.js";
import { resolveModel } from "../../../roles/index.js";
import { WORKER_SESSION_ACTION } from "../const.js";
import type { DispatchPlan, DispatchPlanInput } from "./types.js";

/**
 * Plan a concrete worker session from the selected slot and resolved role config.
 * Reuse is allowed only when the slot's key matches the deterministic identity.
 * @param input - Project, issue, role, level, slot, and context reset decision.
 */
export function buildDispatchPlan(input: DispatchPlanInput): DispatchPlan {
  const { project, role, level, slotIndex, slot } = input;
  const botName = slotName(project.name, role, level, slotIndex);
  const sessionKey = formatWorkerSessionKey(input.agentId ?? "unknown", `${project.slug}-${role}-${level}-${botName.toLowerCase()}`);
  const sameIssueReturn = slot.issueId === input.issueId || slot.lastIssueId === input.issueId;
  const reusable = slot.sessionKey !== null
    && slot.sessionKey === sessionKey
    && (slot.issueId !== null || sameIssueReturn)
    && !input.clearExisting;

  return {
    role, level, slotIndex,
    model: resolveModel(role, level, input.resolvedRole),
    botName,
    sessionKey,
    sessionAction: reusable ? WORKER_SESSION_ACTION.SEND : WORKER_SESSION_ACTION.SPAWN,
    sessionKeyToDelete: slot.sessionKey && !reusable ? slot.sessionKey : null,
  };
}
