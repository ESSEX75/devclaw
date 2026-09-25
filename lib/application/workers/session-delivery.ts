/** Observes gateway submission briefly without waiting for a full agent turn. */
import { submitAgentTurn } from "../../integrations/openclaw/session.js";
import type { AgentTurnInput, AgentTurnOutcome } from "../../integrations/openclaw/types.js";
import type { SessionDeliveryObservation } from "./types.js";

/** Acceptance window for explicit gateway command rejection before dispatch returns. */
const ACCEPTANCE_WINDOW_MS = 25;

/**
 * Submit one turn and distinguish a prompt rejection from an unresolved long-running command.
 * The settled promise remains observable when the initial result is pending.
 * @param sessionKey - Deterministic worker session identity.
 * @param taskMessage - Complete task context sent to the worker.
 * @param input - Gateway addressing, idempotency, and command capability.
 */
export async function beginWorkerDelivery(
  sessionKey: string,
  taskMessage: string,
  input: AgentTurnInput,
): Promise<SessionDeliveryObservation> {
  const settled = submitAgentTurn(sessionKey, taskMessage, input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<{ kind: "pending" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "pending" }), ACCEPTANCE_WINDOW_MS);
  });
  const initial: AgentTurnOutcome | { kind: "pending" } = await Promise.race([settled, pending]);

  if (timer) clearTimeout(timer);

  return { initial, settled };
}
