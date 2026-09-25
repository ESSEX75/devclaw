/** Tests pure session reuse and reset planning for configured worker slots. */
import assert from "node:assert/strict";
import { it } from "node:test";

import { emptySlot } from "../../domain/index.js";
import { createTestHarness } from "../../testing/index.js";
import { buildDispatchPlan } from "./plan.js";

it("reuses a returning issue session and resets it for a different issue or budget decision", async () => {
  const h = await createTestHarness();

  try {
    const base = {
      project: h.project, agentId: h.project.agentId,
      issueId: 91, role: "developer", level: "medior", slotIndex: 0,
      slot: emptySlot(), clearExisting: false,
    };
    const first = buildDispatchPlan(base);
    const previous = { ...emptySlot(), sessionKey: first.sessionKey, lastIssueId: 91 };
    const returning = buildDispatchPlan({ ...base, slot: previous });
    const otherIssue = buildDispatchPlan({ ...base, issueId: 92, slot: previous });
    const overBudget = buildDispatchPlan({ ...base, slot: previous, clearExisting: true });

    assert.equal(returning.sessionAction, "send");
    assert.equal(returning.sessionKeyToDelete, null);
    assert.equal(otherIssue.sessionAction, "spawn");
    assert.equal(otherIssue.sessionKeyToDelete, first.sessionKey);
    assert.equal(overBudget.sessionAction, "spawn");
    assert.equal(overBudget.sessionKeyToDelete, first.sessionKey);
  } finally {
    await h.cleanup();
  }
});
