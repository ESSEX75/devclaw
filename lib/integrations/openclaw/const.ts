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

/** Maximum wait for a read-only gateway status observation. */
export const GATEWAY_STATUS_TIMEOUT_MS = 15_000;

/** Gateway RPC reporting session store locations and recent observations. */
export const GATEWAY_STATUS_METHOD = "status";

/** Text encoding of gateway-owned session stores. */
export const SESSION_STORE_ENCODING = "utf-8";

/** SDK bootstrap event consumed by the role-instruction adapter. */
export const WORKER_BOOTSTRAP_HOOK = "agent:bootstrap";

/** Worker bootstrap instruction resource supplied by the SDK. */
export const WORKER_BOOTSTRAP_FILE = "AGENTS.md";

/** Registration identity of the worker instruction hook. */
export const WORKER_BOOTSTRAP_REGISTRATION = "devclaw-bootstrap-role-instructions";
