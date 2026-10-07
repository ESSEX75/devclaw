/** Gateway protocol identifiers shared by session adapters. */

/** Gateway method that removes one exact worker session. */
export const SESSION_DELETE_METHOD = "sessions.delete";

/** Bound for optional session cleanup before a worker submission. */
export const SESSION_DELETE_TIMEOUT_MS = 10_000;

/** Gateway method that persists and confirms a session's model selection. */
export const SESSION_PATCH_METHOD = "sessions.patch";

/** Observed gateway submission outcomes, distinct from application pending observation. */
export const AGENT_TURN_STATUS = { ACCEPTED: "accepted", REJECTED: "rejected", UNKNOWN: "unknown" } as const;

/** Session namespaces understood by the gateway. */
export const WORKER_SESSION_NAMESPACE = { AGENT: "agent", WORKER: "subagent" } as const;
