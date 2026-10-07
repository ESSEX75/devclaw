/** Owns gateway session protocol identifiers and transport bounds. */

/** Gateway method that removes one exact worker session. */
export const SESSION_DELETE_METHOD = "sessions.delete";

/** Bound for optional session cleanup before a worker submission. */
export const SESSION_DELETE_TIMEOUT_MS = 10_000;

/** Gateway method that persists and confirms a session's model selection. */
export const SESSION_PATCH_METHOD = "sessions.patch";

/** Observed gateway submission outcomes, distinct from application pending observation. */
export const AGENT_TURN_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNKNOWN: "unknown",
} as const;

/** Session namespaces understood by the gateway. */
export const WORKER_SESSION_NAMESPACE = {
  AGENT: "agent",
  WORKER: "subagent",
} as const;

/** Maximum wait for a read-only gateway status observation. */
export const GATEWAY_STATUS_TIMEOUT_MS = 15_000;

/** Gateway RPC reporting session store locations and recent observations. */
export const GATEWAY_STATUS_METHOD = "status";

/** Text encoding of gateway-owned session stores. */
export const SESSION_STORE_ENCODING = "utf-8";

/** Prefix of opaque gateway idempotency identities supplied by application orchestration. */
export const AGENT_TURN_IDEMPOTENCY_PREFIX = "devclaw";

/** CLI prefix shared by the supported gateway session RPCs. */
export const GATEWAY_COMMAND = ["openclaw", "gateway", "call"] as const;

/** Gateway method for one application-selected worker turn. */
export const AGENT_TURN_METHOD = "agent";

/** Worker-turn execution lane, independent of role/level names. */
export const AGENT_TURN_LANE = "subagent";

/** Default plugin agent address retained when no explicit owner is supplied. */
export const DEFAULT_GATEWAY_AGENT_ID = "devclaw";

/** Fallback transport bound when application has not supplied a dispatch timeout. */
export const AGENT_TURN_TIMEOUT_MS = 600_000;
