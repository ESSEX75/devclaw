/** Observes gateway submission briefly without waiting for a full agent turn. */

import { WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import { submitAgentTurn } from "../../../integrations/openclaw/session.js";
import type { AgentTurnInput, AgentTurnOutcome } from "../../../integrations/openclaw/types.js";
import { DELIVERY_ACCEPTANCE_WINDOW_MS } from "./const.js";
import type { SessionDeliveryObservation } from "./types.js";

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
  const pending = new Promise<{ kind: typeof WORKER_DELIVERY_STATUS.PENDING }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: WORKER_DELIVERY_STATUS.PENDING }), DELIVERY_ACCEPTANCE_WINDOW_MS);
  });
  const initial: AgentTurnOutcome | { kind: typeof WORKER_DELIVERY_STATUS.PENDING } = await Promise.race([settled, pending]);

  if (timer) clearTimeout(timer);

  return { initial, settled };
}
