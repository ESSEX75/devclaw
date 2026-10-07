/** Formats deterministic gateway session identities without reading or mutating the gateway. */

import { WORKER_SESSION_NAMESPACE } from "./const.js";

/** Qualify an application-owned worker identifier in the owning OpenClaw agent namespace.
 * @param agentId - Resolved OpenClaw agent, or an explicit unresolved diagnostic identity.
 * @param workerId - Stable identifier selected by application project/slot policy.
 */
export function formatWorkerSessionKey(agentId: string, workerId: string): string {
  return `${WORKER_SESSION_NAMESPACE.AGENT}:${agentId}:${WORKER_SESSION_NAMESPACE.WORKER}:${workerId}`;
}
