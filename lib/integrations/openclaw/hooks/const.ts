/** Owns SDK hook identities, instruction resources and canonical incoming route delimiters. */

/** SDK bootstrap event consumed by the role-instruction adapter. */
export const WORKER_BOOTSTRAP_HOOK = "agent:bootstrap";

/** Worker bootstrap instruction resource supplied by the SDK. */
export const WORKER_BOOTSTRAP_FILE = "AGENTS.md";

/** Registration identity of the worker instruction hook. */
export const WORKER_BOOTSTRAP_REGISTRATION = "devclaw-bootstrap-role-instructions";

/** Hook delivering normalized incoming message metadata. */
export const ATTACHMENT_MESSAGE_HOOK = "message_received";

/** Agent identity is accepted only from an explicitly scoped canonical session key. */
export const ATTACHMENT_AGENT_SESSION = /^agent:([^:]+):/;

/** Telegram topic qualifier accepted in canonical conversation ids. */
export const ATTACHMENT_TOPIC_SEPARATOR = ":topic:";
