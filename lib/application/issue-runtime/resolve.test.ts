/** Checks that runtime resolution never substitutes provider projection for local truth. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";

import { DEFAULT_WORKFLOW, ISSUE_PROVIDER } from "../../domain/index.js";
import { createTestHarness } from "../../testing/index.js";
import { resolveIssueRuntimeState } from "./resolve.js";
import { writeIssueRuntimeState } from "./write.js";

describe("resolveIssueRuntimeState", () => {
  it("reports uninitialized projection without creating files", async () => {
    const harness = await createTestHarness();

    try {
      const before = await fs.readdir(harness.workspaceDir, { recursive: true });
      const result = await resolveIssueRuntimeState({ workspaceDir: harness.workspaceDir,
        project: harness.project, issue: { iid: 42, labels: ["Doing"] }, workflow: DEFAULT_WORKFLOW });

      assert.equal(result.kind, "uninitialized");
      assert.equal(result.state, null);
      assert.equal(result.workflowState, "doing");
      assert.equal(result.workflowLabel, "Doing");
      assert.deepEqual(await fs.readdir(harness.workspaceDir, { recursive: true }), before);
    } finally {
      await harness.cleanup();
    }
  });

  it("retains local workflow and refuses a config match by label alone", async () => {
    const harness = await createTestHarness();

    try {
      const input = { workspaceDir: harness.workspaceDir, project: harness.project,
        issue: { iid: 42, labels: ["To Do"] }, workflow: DEFAULT_WORKFLOW };

      await writeIssueRuntimeState({ ...input, providerType: ISSUE_PROVIDER.GITHUB });
      const drifted = { ...input, issue: { iid: 42, labels: ["Doing"] } };
      const result = await resolveIssueRuntimeState(drifted);

      assert.equal(result.kind, "managed");
      assert.equal(result.workflowState, "todo");
      assert.equal(result.workflowLabel, "To Do");
      assert.deepEqual(result.stateConfig, DEFAULT_WORKFLOW.states.todo);
      const states = Object.fromEntries(Object.entries(DEFAULT_WORKFLOW.states).filter(([key]) => key !== "todo"));

      states.renamed = DEFAULT_WORKFLOW.states.todo!;
      const renamed = await resolveIssueRuntimeState({ ...drifted, workflow: { ...DEFAULT_WORKFLOW, states } });

      assert.equal(renamed.stateConfig, null);
      assert.equal(renamed.workflowState, "todo");
      assert.equal(renamed.workflowLabel, "To Do");
    } finally {
      await harness.cleanup();
    }
  });
});
