/** Verifies provider review classification before heartbeat selects a transition. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REVIEW_CHECK } from "../../../domain/index.js";
import { classifyReviewOutcome } from "./review-outcome.js";

describe("review provider outcomes", () => {
  it("distinguishes approval, conflict, feedback, closed PR, missing PR and pending status", () => {
    assert.equal(classifyReviewOutcome({ state: "approved", url: "pr" }, REVIEW_CHECK.PR_APPROVED).kind, "approved");
    assert.equal(classifyReviewOutcome({ state: "approved", url: "pr" }, REVIEW_CHECK.PR_MERGED).kind, "pending");
    assert.equal(classifyReviewOutcome({ state: "merged", url: "pr" }, REVIEW_CHECK.PR_MERGED).kind, "approved");
    assert.equal(classifyReviewOutcome({ state: "approved", url: "pr", mergeable: false }, REVIEW_CHECK.PR_APPROVED).kind, "conflict");
    assert.equal(classifyReviewOutcome({ state: "changes_requested", url: "pr" }, REVIEW_CHECK.PR_APPROVED).kind, "changes_requested");
    assert.equal(classifyReviewOutcome({ state: "closed", url: "pr" }, REVIEW_CHECK.PR_APPROVED).kind, "closed_unmerged");
    assert.equal(classifyReviewOutcome({ state: "closed", url: null }, REVIEW_CHECK.PR_APPROVED).kind, "missing_pr");
    assert.equal(classifyReviewOutcome({ state: "open", url: "pr" }, REVIEW_CHECK.PR_APPROVED).kind, "pending");
    assert.equal(classifyReviewOutcome({ state: "changes_requested", url: "pr", mergeable: false }, REVIEW_CHECK.PR_APPROVED, false, true).kind, "conflict");
    assert.equal(classifyReviewOutcome({ state: "closed", url: "pr", mergeable: false }, REVIEW_CHECK.PR_APPROVED, true, false).kind, "closed_unmerged");
  });
});
