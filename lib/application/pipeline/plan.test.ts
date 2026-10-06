/** Characterizes pure completion and review planning before provider effects. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WORKFLOW, WORKFLOW_EVENT } from "../../domain/index.js";
import { getAllRoleIds, getBuiltInRole } from "../../roles/index.js";
import { planCompletion, planMergeFailure, planWorkflowEvent } from "./plan.js";

describe("workflow transition plans", () => {
  it("plans every built-in role result through the configured workflow", () => {
    for (const roleId of getAllRoleIds()) {
      const role = getBuiltInRole(roleId);
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
    const developer = getBuiltInRole("developer");
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
