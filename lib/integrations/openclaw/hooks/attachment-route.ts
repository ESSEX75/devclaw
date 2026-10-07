/** Normalizes SDK attachment routing without discovering workspaces or selecting a managed project. */

import { ATTACHMENT_AGENT_SESSION, ATTACHMENT_TOPIC_SEPARATOR } from "./const.js";
import type { AttachmentMessageContext, AttachmentMessageEvent, AttachmentMessageRoute } from "./types.js";

/** Retain an exact scoped owner/account/conversation route; incomplete or contradictory identities are rejected.
 * @param event - SDK-normalized message, including optional explicit thread/session identities.
 * @param context - SDK context supplying channel, account and conversation scope.
 */
export function normalizeAttachmentRoute(event: AttachmentMessageEvent, context: AttachmentMessageContext): AttachmentMessageRoute | null {
  const sessionKey = context.sessionKey ?? event.sessionKey;
  const agentId = sessionKey ? ATTACHMENT_AGENT_SESSION.exec(sessionKey)?.[1] : undefined;

  if (!context.accountId || !context.conversationId || !agentId) return null;
  const [conversationId, topic, ...extra] = context.conversationId.split(ATTACHMENT_TOPIC_SEPARATOR);

  if (!conversationId || extra.length || (topic !== undefined && !topic)) return null;
  const threadId = event.threadId === undefined ? topic : String(event.threadId);

  if (topic !== undefined && threadId !== topic) return null;

  return { channel: context.channelId, accountId: context.accountId, conversationId, threadId, agentId };
}
