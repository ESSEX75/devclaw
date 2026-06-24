import { describe, it } from "node:test";
import assert from "node:assert";
import { TestProvider } from "../testing/test-provider.js";
import { DEFAULT_WORKFLOW, StateType, type WorkflowConfig } from "../workflow/index.js";
import { cleanupTerminalStateLabels } from "./pipeline.js";

describe("pipeline terminal state label cleanup", () => {
  it("removes stale default workflow state labels and preserves human labels", async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 1, labels: ["Doing", "To Review", "Done", "bug"] });

    const removed = await cleanupTerminalStateLabels(provider, 1, "Done", DEFAULT_WORKFLOW);
    const issue = await provider.getIssue(1);

    assert.deepStrictEqual(removed, ["Doing", "To Review"]);
    assert.deepStrictEqual(issue.labels.sort(), ["Done", "bug"]);
  });

  it("uses the supplied workflow instead of hardcoded default labels", async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 2, labels: ["QA Active", "QA Done", "human"] });
    const workflow: WorkflowConfig = {
      ...DEFAULT_WORKFLOW,
      states: {
        ...DEFAULT_WORKFLOW.states,
        testing: {
          ...DEFAULT_WORKFLOW.states.testing!,
          label: "QA Active",
        },
        done: {
          type: StateType.TERMINAL,
          label: "QA Done",
          color: "#5cb85c",
        },
      },
    };

    const removed = await cleanupTerminalStateLabels(provider, 2, "QA Done", workflow);
    const issue = await provider.getIssue(2);

    assert.deepStrictEqual(removed, ["QA Active"]);
    assert.deepStrictEqual(issue.labels.sort(), ["QA Done", "human"]);
  });

  it("is idempotent when only the terminal label remains", async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 3, labels: ["Done", "human"] });

    const removed = await cleanupTerminalStateLabels(provider, 3, "Done", DEFAULT_WORKFLOW);
    const issue = await provider.getIssue(3);

    assert.deepStrictEqual(removed, []);
    assert.deepStrictEqual(issue.labels.sort(), ["Done", "human"]);
    assert.strictEqual(provider.callsTo("removeLabels").length, 0);
  });
});
