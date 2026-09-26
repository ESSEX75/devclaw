/** SDK identifiers used by automatic attachment capture. */
/** Hook delivering normalized incoming message metadata. */
export const ATTACHMENT_MESSAGE_HOOK = "message_received";
/** Agent identity is accepted only from an explicitly scoped canonical session key. */
export const ATTACHMENT_AGENT_SESSION = /^agent:([^:]+):/;
/** Telegram topic qualifier accepted in canonical conversation ids. */
export const ATTACHMENT_TOPIC_SEPARATOR = ":topic:";
