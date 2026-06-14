/**
 * Tests for work_finish PR/MR target branch validation.
 *
 * Run: npx tsx --test lib/tools/worker/work-finish-branch-validation.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { PrState } from "../../providers/provider.js";
import { validatePrTargetBranch } from "./work-finish.js";

describe("work_finish target branch validation", () => {
  it("accepts issue mode PR into base branch", () => {
    assert.doesNotThrow(() => validatePrTargetBranch({
      state: PrState.OPEN,
      url: "https://example.com/pr/1",
      sourceBranch: "issue/42-login",
      targetBranch: "main",
    }, "main"));
  });

  it("rejects sprint child PR into base branch instead of sprint branch", () => {
    assert.throws(
      () => validatePrTargetBranch({
        state: PrState.OPEN,
        url: "https://example.com/pr/2",
        sourceBranch: "step/101-config",
        targetBranch: "main",
      }, "sprint/100-feature"),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /target branch mismatch/);
        assert.match(err.message, /Expected target branch: sprint\/100-feature/);
        assert.match(err.message, /Actual target branch: main/);
        return true;
      },
    );
  });

  it("does not rely on provider warning text when target branch is structured", () => {
    assert.throws(
      () => validatePrTargetBranch({
        state: PrState.OPEN,
        url: "https://example.com/pr/3",
        sourceBranch: "step/101-config",
        baseBranch: "main",
      }, "sprint/100-feature"),
      /Actual target branch: main/,
    );
  });
});
