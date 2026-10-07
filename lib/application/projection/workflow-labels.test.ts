/** Verifies workflow-owned label selection, two-phase failure behavior and provider-neutral effects. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { DEFAULT_WORKFLOW, getLabelColors, getStateLabels, type WorkflowConfig } from "../../domain/index.js";
import { TestProvider } from "../../testing/index.js";
import { ensureWorkflowLabels, transitionWorkflowLabel } from "./workflow-labels.js";

it("ensures every configured workflow color through explicit provider commands", async () => {
  const provider = new TestProvider();
  const workflow: WorkflowConfig = structuredClone(DEFAULT_WORKFLOW);
  workflow.states.todo.label = "Custom queue";
  workflow.states.todo.color = "#abcdef";
  await ensureWorkflowLabels(provider, workflow);
  assert.deepEqual(provider.labels, getLabelColors(workflow));
  assert.deepEqual(provider.callsTo("ensureLabel").map(call => call.args.name), getStateLabels(workflow));
});

it("projects custom workflow labels while preserving unrelated provider labels", async () => {
  const provider = new TestProvider();
  const workflow: WorkflowConfig = structuredClone(DEFAULT_WORKFLOW);
  workflow.states.todo.label = "Custom queue";
  workflow.states.doing.label = "Custom active";
  provider.seedIssue({ iid: 1, labels: ["Custom queue", "bug", "Doing"] });
  await transitionWorkflowLabel(provider, workflow, 1, "Custom queue", "Custom active");
  assert.deepEqual((await provider.getIssue(1)).labels, ["bug", "Doing", "Custom active"]);
  assert.ok(provider.calls.findIndex(call => call.method === "addLabels") < provider.calls.findIndex(call => call.method === "removeLabels"));
});

it("retains the original label and performs no cleanup when target addition fails", async t => {
  const provider = new TestProvider();
  provider.seedIssue({ iid: 1, labels: ["To Do"] });
  t.mock.method(provider, "addLabels", async () => { throw new Error("addition rejected"); });
  await assert.rejects(transitionWorkflowLabel(provider, DEFAULT_WORKFLOW, 1, "To Do", "Doing"), /addition rejected/);
  assert.deepEqual(provider.issues.get(1)?.labels, ["To Do"]);
  assert.equal(provider.callsTo("removeLabels").length, 0);
});

for (const failure of ["read", "remove"]) {
  it(`keeps the target and propagates required cleanup ${failure} failure`, async t => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 1, labels: ["To Do", "bug"] });
    if (failure === "read") t.mock.method(provider, "getIssue", async () => { throw new Error("cleanup failed"); });
    else t.mock.method(provider, "removeLabels", async () => { throw new Error("cleanup failed"); });
    await assert.rejects(transitionWorkflowLabel(provider, DEFAULT_WORKFLOW, 1, "To Do", "Doing"), /cleanup failed/);
    assert.deepEqual(provider.issues.get(1)?.labels, ["To Do", "bug", "Doing"]);
    assert.equal(provider.callsTo("addLabels").length, 1);
  });
}

it("does not invalidate an applied projection when the optional final observation fails", async t => {
  const provider = new TestProvider();
  provider.seedIssue({ iid: 1, labels: ["To Do", "bug"] });
  const getIssue = provider.getIssue.bind(provider);
  let reads = 0;
  t.mock.method(provider, "getIssue", async (issueId: number) => {
    if (++reads === 2) throw new Error("diagnostic unavailable");
    return getIssue(issueId);
  });
  await transitionWorkflowLabel(provider, DEFAULT_WORKFLOW, 1, "To Do", "Doing");
  assert.deepEqual(provider.issues.get(1)?.labels, ["bug", "Doing"]);
});

it("resumes cleanup from exact observed evidence without adding the target twice", async () => {
  const provider = new TestProvider();
  const observed = provider.seedIssue({ iid: 1, labels: ["To Do", "Doing", "bug"] });
  await transitionWorkflowLabel(provider, DEFAULT_WORKFLOW, 1, "To Do", "Doing", observed);
  assert.equal(provider.callsTo("addLabels").length, 0);
  assert.deepEqual(provider.issues.get(1)?.labels, ["Doing", "bug"]);
});

it("rejects recovery evidence from another issue before any provider effect", async () => {
  const provider = new TestProvider();
  const foreign = provider.seedIssue({ iid: 2, labels: ["Doing"] });
  await assert.rejects(transitionWorkflowLabel(provider, DEFAULT_WORKFLOW, 1, "To Do", "Doing", foreign), /different issue/);
  assert.equal(provider.calls.length, 0);
});
