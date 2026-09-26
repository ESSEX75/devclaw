/** Characterizes pure completion and review planning before provider effects. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WORKFLOW, REVIEW_CHECK, WORKFLOW_EVENT } from "../../domain/index.js";
import { getAllRoleIds, getRole } from "../../roles/index.js";
import { planCompletion, planMergeFailure, planWorkflowEvent } from "./plan.js";
import { classifyReviewOutcome } from "./review-outcome.js";

describe("workflow transition plans", () => {
  it("plans every built-in role result through the configured workflow", () => {
    for (const roleId of getAllRoleIds()) {
      const role = getRole(roleId);
      assert.ok(role);
      for (const result of Object.keys(role.completion)) {
        const plan = planCompletion(DEFAULT_WORKFLOW, roleId, result, role.completion);
        assert.equal(plan.transition.from, plan.rule.from);
        assert.equal(plan.transition.toLabel, plan.rule.to);
        assert.ok(Object.keys(DEFAULT_WORKFLOW.states).includes(plan.transition.toState));
      }
    }
  });

  it("rejects unknown results and mismatched source states before a transition exists", () => {
    const developer = getRole("developer");
    assert.ok(developer);
    assert.throws(() => planCompletion(DEFAULT_WORKFLOW, "developer", "unknown", developer.completion));
    assert.equal(planWorkflowEvent(DEFAULT_WORKFLOW, "Done", WORKFLOW_EVENT.APPROVED), null);
  });

  it("resolves merge failure to recovery rather than the success state", () => {
    const failure = planMergeFailure(DEFAULT_WORKFLOW, "To Review");
    assert.equal(failure?.toLabel, "To Improve");
    assert.notEqual(failure?.toLabel, planWorkflowEvent(DEFAULT_WORKFLOW, "To Review", WORKFLOW_EVENT.APPROVED)?.toLabel);
  });
});

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
