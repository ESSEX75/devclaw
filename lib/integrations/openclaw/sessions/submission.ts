/** Submits one gateway worker turn with an application-owned immutable token and conservative delivery evidence. */

import { isCompletedCommand } from "../../process/index.js";
import { AGENT_TURN_IDEMPOTENCY_PREFIX, AGENT_TURN_LANE, AGENT_TURN_METHOD, AGENT_TURN_STATUS, AGENT_TURN_TIMEOUT_MS, DEFAULT_GATEWAY_AGENT_ID, GATEWAY_COMMAND } from "./const.js";
import type { AgentTurnInput, AgentTurnOutcome } from "./types.js";

/**
 * Observe the gateway command result without interpreting transport failure as rejection.
 * Only local input validation proves that the command was never submitted.
 * @param sessionKey - Deterministic worker session identity.
 * @param taskMessage - Complete task context to submit.
 * @param opts - Gateway address, idempotency, and command capability.
 */
export async function submitAgentTurn(sessionKey: string, taskMessage: string, opts: AgentTurnInput): Promise<AgentTurnOutcome> {
  if (!sessionKey.trim() || !taskMessage.trim() || (typeof opts.submissionId !== "string" || !opts.submissionId.trim()) || (opts.agentId !== undefined && !opts.agentId.trim())) {
    return { kind: AGENT_TURN_STATUS.REJECTED, reason: "Gateway worker turn has invalid local submission input." };
  }

  try {
    const result = await opts.runCommand(agentCommand(sessionKey, taskMessage, opts), {
      timeoutMs: opts.dispatchTimeoutMs ?? AGENT_TURN_TIMEOUT_MS,
    });

    if (!isCompletedCommand(result)) {
      return { kind: AGENT_TURN_STATUS.UNKNOWN,
        reason: `Gateway command ended abnormally (${result.termination}, signal ${result.signal}, killed ${result.killed}).` };
    }

    if (result.code !== 0) {
      return { kind: AGENT_TURN_STATUS.UNKNOWN, reason: `Gateway command failed after submission (exit ${result.code}): ${result.stderr}` };
    }

    return { kind: AGENT_TURN_STATUS.ACCEPTED };
  } catch (error) {
    return { kind: AGENT_TURN_STATUS.UNKNOWN, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Build the shared gateway RPC with a stable key so a replay addresses one turn.
 * @param sessionKey - Deterministic worker session identity.
 * @param taskMessage - Complete task context to submit.
 * @param opts - Immutable submission token, agent address and optional parent session context.
 */
function agentCommand(sessionKey: string, taskMessage: string, opts: AgentTurnInput): string[] {
  const gatewayParams = JSON.stringify({
    idempotencyKey: `${AGENT_TURN_IDEMPOTENCY_PREFIX}-${opts.submissionId}`,
    agentId: opts.agentId ?? DEFAULT_GATEWAY_AGENT_ID,
    sessionKey,
    message: taskMessage,
    deliver: false,
    lane: AGENT_TURN_LANE,
    ...(opts.orchestratorSessionKey ? { spawnedBy: opts.orchestratorSessionKey } : {}),
    ...(opts.extraSystemPrompt ? { extraSystemPrompt: opts.extraSystemPrompt } : {}),
  });

  return [...GATEWAY_COMMAND, AGENT_TURN_METHOD, "--params", gatewayParams, "--expect-final", "--json"];
}
