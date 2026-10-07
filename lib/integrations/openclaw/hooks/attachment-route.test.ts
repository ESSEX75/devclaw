/** Exercises exact SDK attachment route normalization without project discovery or provider effects. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { normalizeAttachmentRoute } from "./attachment-route.js";

/** Complete route fixture retaining a custom owner identity rather than a built-in role pattern. */
const context = { channelId: "telegram", accountId: "account-one", conversationId: "chat-one:topic:12", sessionKey: "agent:custom-owner:main" };

/** SDK message fixture without optional route overrides. */
const event = { from: "sender", content: "Evidence #42" };

it("retains the exact owner/account/conversation/topic and reconciles explicit numeric thread identity", () => {
  const expected = { channel: "telegram", accountId: "account-one", conversationId: "chat-one", threadId: "12", agentId: "custom-owner" };
  assert.deepEqual(normalizeAttachmentRoute(event, context), expected);
  assert.deepEqual(normalizeAttachmentRoute({ ...event, threadId: 12 }, context), expected);
});

it("uses an event session only when SDK context did not supply one", () => {
  assert.equal(normalizeAttachmentRoute({ ...event, sessionKey: "agent:event-owner:main" }, context)?.agentId, "custom-owner");
  assert.equal(normalizeAttachmentRoute({ ...event, sessionKey: "agent:event-owner:main" }, { ...context, sessionKey: undefined })?.agentId, "event-owner");
});

it("rejects missing account, unscoped owner and conflicting thread identities", () => {
  assert.equal(normalizeAttachmentRoute(event, { ...context, accountId: undefined }), null);
  assert.equal(normalizeAttachmentRoute(event, { ...context, sessionKey: "main" }), null);
  assert.equal(normalizeAttachmentRoute(event, { ...context, sessionKey: undefined }), null);
  assert.equal(normalizeAttachmentRoute({ ...event, threadId: 13 }, context), null);
});

it("rejects empty or multiply qualified conversations rather than inventing a destination", () => {
  for (const conversationId of ["", ":topic:12", "chat-one:topic:", "chat-one:topic:12:topic:13"]) {
    assert.equal(normalizeAttachmentRoute(event, { ...context, conversationId }), null);
  }
});
