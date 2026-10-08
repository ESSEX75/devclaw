/** Verifies acknowledgement uses explicit resource identity and isolates provider failures. */

import assert from "node:assert/strict";
import { it } from "node:test";
import { PR_COMMENT_KIND } from "../../integrations/index.js";
import { acknowledgeComments } from "./acknowledge-comments.js";
import type { AcknowledgementProvider, PrFeedback } from "./types.js";

it("keeps colliding resource IDs separate and skips already acknowledged comments", async () => {
  const writes: string[] = [];
  const marked = new Set<string>();
  const provider: AcknowledgementProvider = {
    issueCommentHasReaction: async (_, id) => marked.has(`issue:${id}`),
    prCommentHasReaction: async (_, id) => marked.has(`conversation:${id}`),
    prReviewCommentHasReaction: async (_, id) => marked.has(`inline:${id}`),
    reactToIssueComment: async (_, id) => { writes.push(`issue:${id}`); marked.add(`issue:${id}`); },
    reactToPrComment: async (_, id) => { writes.push(`conversation:${id}`); marked.add(`conversation:${id}`); },
    reactToPrReviewComment: async (_, id) => { writes.push(`inline:${id}`); marked.add(`inline:${id}`); },
  };
  const feedback: PrFeedback = { url: "pr", comments: Object.values(PR_COMMENT_KIND).map((kind) => ({
    kind, id: 42, author: "reviewer", body: "feedback", state: "COMMENTED",
  })) };
  const comments = [{ id: 42, author: "author", body: "task", created_at: "today" }];
  await acknowledgeComments(provider, 1, comments, feedback);
  await acknowledgeComments(provider, 1, comments, feedback);
  assert.deepEqual(writes, ["issue:42", "inline:42", "conversation:42"]);
});

it("does not write after a failed reaction lookup and continues with remaining comments", async () => {
  const writes: number[] = [];
  const provider: AcknowledgementProvider = {
    issueCommentHasReaction: async (_, id) => { if (id === 1) throw new Error("offline"); return false; },
    reactToIssueComment: async (_, id) => { if (id === 2) throw new Error("denied"); writes.push(id); },
    prCommentHasReaction: async () => false,
    reactToPrComment: async () => {},
    prReviewCommentHasReaction: async () => false,
    reactToPrReviewComment: async () => {},
  };
  await acknowledgeComments(provider, 1, [1, 2, 3].map((id) => ({ id, author: "author", body: "task", created_at: "today" })));
  assert.deepEqual(writes, [3]);
});
