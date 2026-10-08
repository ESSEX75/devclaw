/** Checks PR feedback rendering through the standard Node test runner. */

import { PR_COMMENT_KIND } from "../../integrations/index.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPrFeedback } from "./format.js";
import type { PrFeedback } from "./types.js";

describe("formatPrFeedback", () => {
  it("retains conflict context when no comments", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/123-test",
      reason: "merge_conflict",
      comments: [],
    };
    const result = formatPrFeedback(feedback, "main");
    assert.ok(result.join("\n").includes("feature/123-test"));
  });

  it("includes branch name in conflict resolution instructions", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/456-test",
      reason: "merge_conflict",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Conflicts detected",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.ok(text.includes("feature/456-test"));
    assert.ok(text.includes("🔹 Branch: `feature/456-test`"));
    assert.ok(text.includes("git checkout feature/456-test"));
    assert.ok(text.includes("git push --force-with-lease origin feature/456-test"));
  });

  it("asks to identify the source branch when not provided", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      reason: "merge_conflict",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Conflicts detected",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.ok(!text.includes("your-branch"));
    assert.ok(text.includes("Find the source branch using the PR URL"));
  });

  it("includes step-by-step instructions for conflict resolution", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/123-fix",
      reason: "merge_conflict",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Fix the conflicts",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "develop");
    const text = result.join("\n");

    // Check all steps are present
    assert.ok(text.includes("1. Fetch and check out the PR branch"));
    assert.ok(text.includes("2. Rebase onto `develop`"));
    assert.ok(text.includes("3. Resolve any conflicts"));
    assert.ok(text.includes("4. Force-push to the SAME branch"));
    assert.ok(text.includes("5. Verify the PR shows as mergeable"));

    // Check warning about not creating new PR
    assert.ok(text.includes("⚠️ Do NOT create a new PR"));
    assert.ok(text.includes("Do NOT switch branches"));
    assert.ok(text.includes("Update THIS PR only"));
  });

  it("correctly formats changes_requested feedback", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/456",
      branchName: "feature/789-feature",
      reason: "changes_requested",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Please make these changes",
          state: "CHANGES_REQUESTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.ok(text.includes("⚠️ Changes were requested"));
    assert.ok(text.includes("Please make these changes"));
    // Should NOT have conflict resolution instructions
    assert.ok(!text.includes("Conflict Resolution Instructions"));
  });

  it("includes comment location information when available", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/456-test",
      reason: "changes_requested",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Fix this logic",
          state: "CHANGES_REQUESTED",
          path: "src/index.ts",
          line: 42,
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.ok(text.includes("(src/index.ts:42)"));
  });

  it("uses correct base branch in rebase command", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/test",
      reason: "merge_conflict",
      comments: [
        {
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: 1,
          author: "reviewer",
          body: "Conflicts",
          state: "COMMENTED",
        },
      ],
    };

    // Test with "main" base branch
    let result = formatPrFeedback(feedback, "main");
    let text = result.join("\n");
    assert.ok(text.includes("git rebase main"));

    // Test with "develop" base branch
    result = formatPrFeedback(feedback, "develop");
    text = result.join("\n");
    assert.ok(text.includes("git rebase develop"));
  });
});
