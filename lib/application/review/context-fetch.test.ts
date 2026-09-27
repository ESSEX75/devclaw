/** Exercises partial provider failures and bounded worker context rendering. */

import assert from "node:assert/strict";
import { it } from "node:test";
import { PR_COMMENT_KIND, PrState } from "../../integrations/providers/index.js";
import { PR_DIFF_LIMIT } from "./const.js";
import { formatPrContext, formatPrFeedback } from "./format.js";
import { fetchPrContext, fetchPrFeedback } from "./pr-context.js";
import type { FeedbackProvider } from "./types.js";

it("preserves conflict identity when secondary comments cannot be read", async () => {
  const feedback = await fetchPrFeedback({
    getPrStatus: async () => ({ state: PrState.OPEN, url: "https://example.test/pr/1", mergeable: false }),
    getPrReviewComments: async () => { throw new Error("unavailable"); },
  }, 1);
  assert.ok(feedback);
  assert.equal(feedback.reason, "merge_conflict");
  assert.deepEqual(feedback.comments, []);
  assert.match(formatPrFeedback(feedback, "main").join("\n"), /https:\/\/example.test\/pr\/1/);
});

it("rejects terminal PR context even if the provider still reports conflicts", async () => {
  for (const state of [PrState.CLOSED, PrState.MERGED]) {
    const provider = {
      getPrStatus: async () => ({ state, url: "https://example.test/pr/1", mergeable: false }),
      getPrReviewComments: async () => { throw new Error("must not fetch"); },
      getPrDiff: async () => { throw new Error("must not fetch"); },
    };
    assert.equal(await fetchPrFeedback(provider, 1), undefined);
    assert.equal(await fetchPrContext(provider, 1), undefined);
  }
});

it("preserves ordinary feedback resource identity and ignores empty non-conflict feedback", async () => {
  const provider: FeedbackProvider = {
    getPrStatus: async () => ({ state: PrState.CHANGES_REQUESTED, url: "pr", sourceBranch: "feature" }),
    getPrReviewComments: async () => [{ kind: PR_COMMENT_KIND.REVIEW, id: 2, author: "reviewer", body: "fix", state: "COMMENTED", created_at: "today" }],
  };
  const feedback = await fetchPrFeedback(provider, 1);
  assert.equal(feedback?.reason, "changes_requested");
  assert.equal(feedback?.comments[0].kind, PR_COMMENT_KIND.REVIEW);
  provider.getPrReviewComments = async () => [];
  assert.equal(await fetchPrFeedback(provider, 1), undefined);
  assert.deepEqual(formatPrFeedback({ url: "pr", comments: [] }, "main"), []);
});

it("degrades unavailable status to no context and unavailable diff to PR identity", async () => {
  const getPrStatus = async () => { throw new Error("offline"); };
  assert.equal(await fetchPrFeedback({ getPrStatus, getPrReviewComments: async () => [] }, 1), undefined);
  assert.equal(await fetchPrContext({ getPrStatus, getPrDiff: async () => "diff" }, 1), undefined);
  assert.deepEqual(await fetchPrContext({
    getPrStatus: async () => ({ state: PrState.OPEN, url: "pr" }),
    getPrDiff: async () => { throw new Error("offline"); },
  }, 1), { url: "pr", diff: undefined });
});

it("truncates only diffs exceeding the context limit", () => {
  const diff = "x".repeat(PR_DIFF_LIMIT);
  assert.ok(!formatPrContext({ url: "pr", diff }).join("\n").includes("truncated"));
  const result = formatPrContext({ url: "pr", diff: diff + "TAIL" }).join("\n");
  assert.ok(result.includes(diff));
  assert.ok(!result.includes("TAIL"));
  assert.match(result, /diff truncated/);
});
