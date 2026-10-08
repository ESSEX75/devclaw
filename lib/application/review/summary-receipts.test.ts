/** Verifies durable summary acknowledgement, edited feedback, concurrency and unchanged worker ownership. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { PR_COMMENT_KIND, PR_STATE } from "../../integrations/index.js";
import { readIssueStateStore, updateIssueRuntimeRecord } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { fetchPrFeedback } from "./pr-context.js";
import { filterProcessedReviewSummaries, observePrStatusWithReceipts, recordProcessedReviewSummaries } from "./summary-receipts.js";
import { confirmReviewSummaryDelivery, stageReviewSummaryDelivery } from "./summary-delivery.js";
import type { PrFeedback } from "./types.js";

it("only matching accepted summary receipts suppress feedback, retaining edited and other-PR observations", async () => {
  const h = await createTestHarness();
  try {
    const issue = h.provider.seedIssue({ iid: 42, labels: ["To Review"] });
    await writeIssueRuntimeState({ workspaceDir: h.workspaceDir, project: h.project, issue, providerType: h.project.provider,
      workflow: h.workflow, workflowState: "toReview", workflowLabel: "To Review", reviewPolicy: "human" });
    const context = { workspaceDir: h.workspaceDir, projectSlug: h.project.slug };
    const summary = { kind: PR_COMMENT_KIND.REVIEW, id: 7, author: "reviewer", body: "fix", state: "COMMENTED", created_at: "2026-01-01" };
    const feedback: PrFeedback = { url: "https://example.test/pr/1", comments: [summary] };
    const provider = { getPrStatus: async () => ({ state: PR_STATE.HAS_COMMENTS, url: feedback.url,
      reviewSummaries: [summary], hasCommentFeedback: false }), getPrReviewComments: async () => [summary] };
    assert.equal((await observePrStatusWithReceipts(provider, 42, context)).state, PR_STATE.HAS_COMMENTS);
    await recordProcessedReviewSummaries(context, 42, feedback);
    assert.equal((await observePrStatusWithReceipts(provider, 42, context)).state, PR_STATE.OPEN);
    assert.equal((await fetchPrFeedback(provider, 42))?.comments[0].body, summary.body, "retried workers still receive the original feedback");
    assert.equal((await filterProcessedReviewSummaries(context, 42, feedback)).comments.length, 0);
    assert.equal((await filterProcessedReviewSummaries(context, 42, { ...feedback, url: "https://example.test/pr/2" })).comments.length, 1);
    assert.equal((await filterProcessedReviewSummaries(context, 42, { ...feedback, comments: [{ ...summary, body: "edited" }] })).comments.length, 1);
    assert.equal((await filterProcessedReviewSummaries(context, 42, { ...feedback, comments: [{ ...summary, path: "changed.ts" }] })).comments.length, 1);
    assert.equal((await filterProcessedReviewSummaries(context, 42, { ...feedback, comments: [{ ...summary, kind: PR_COMMENT_KIND.INLINE }] })).comments.length, 1);
    assert.equal((await filterProcessedReviewSummaries(context, 42, { ...feedback, comments: [{ ...summary, state: "CHANGES_REQUESTED" }] })).comments.length, 1);
    const stored = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];
    assert.equal(stored.workflowLabel, "To Review");
    assert.equal(stored.activeWorker, null);
  } finally { await h.cleanup(); }
});

it("fresh locked receipt updates preserve concurrent summaries and never initialize a provider-only issue", async () => {
  const h = await createTestHarness();
  try {
    const context = { workspaceDir: h.workspaceDir, projectSlug: h.project.slug };
    const summary = { kind: PR_COMMENT_KIND.REVIEW, id: 1, author: "reviewer", body: "fix", state: "COMMENTED" };
    const feedback: PrFeedback = { url: "pr", comments: [summary] };
    await assert.rejects(recordProcessedReviewSummaries(context, 42, feedback), /uninitialized/);
    const issue = h.provider.seedIssue({ iid: 42, labels: ["Doing"] });
    await writeIssueRuntimeState({ workspaceDir: h.workspaceDir, project: h.project, issue, providerType: h.project.provider,
      workflow: h.workflow, workflowState: "doing", workflowLabel: "Doing" });
    await Promise.all([recordProcessedReviewSummaries(context, 42, feedback),
      recordProcessedReviewSummaries(context, 42, { ...feedback, comments: [{ ...summary, id: 2 }] })]);
    const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];
    assert.deepEqual(state.processedReviewSummaries?.map(receipt => receipt.reviewId).sort(), [1, 2]);
    assert.equal(state.workflowLabel, "Doing");
  } finally { await h.cleanup(); }
});

it("pending context cannot be acknowledged by a different submission or reused session frame", async () => {
  const h = await createTestHarness();
  try {
    const issue = h.provider.seedIssue({ iid: 42, labels: ["Doing"] });
    const worker = { role: "developer", level: "medior", slotIndex: 0, sessionKey: "worker", startedAt: "2026-01-01" };
    await writeIssueRuntimeState({ workspaceDir: h.workspaceDir, project: h.project, issue, providerType: h.project.provider,
      workflow: h.workflow, workflowState: "doing", workflowLabel: "Doing", activeWorker: worker });
    const context = { workspaceDir: h.workspaceDir, projectSlug: h.project.slug };
    const id = "00000000-0000-4000-8000-000000000001";
    await stageReviewSummaryDelivery(context, 42, id, worker, { url: "pr", comments: [
      { kind: PR_COMMENT_KIND.REVIEW, id: 1, author: "reviewer", body: "fix", state: "COMMENTED" },
    ] });
    await confirmReviewSummaryDelivery(context, 42, "00000000-0000-4000-8000-000000000002");
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].processedReviewSummaries, undefined);
    await updateIssueRuntimeRecord(h.workspaceDir, h.project.slug, 42, previous => {
      if (!previous) throw new Error("Missing issue");
      return { ...previous, activeWorker: { ...worker, startedAt: "2026-01-02" } };
    });
    await confirmReviewSummaryDelivery(context, 42, id);
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].processedReviewSummaries, undefined);
  } finally { await h.cleanup(); }
});
