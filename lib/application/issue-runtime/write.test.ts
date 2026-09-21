/**
 * Verifies application-owned projection interpretation before local runtime persistence.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_WORKFLOW, ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";
import {
  createEmptyIssueStateStoreForTesting as emptyIssueStateStore,
  replaceIssueStateStoreForTesting as writeIssueStateStore,
} from "../../testing/index.js";
import { writeIssueRuntimeState } from "./write.js";

/** Build a complete current runtime record for projection-drift tests. */
function issueState(): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    owner: "main",
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    providerMissing: null,
    pipelineNotification: null,
  };
}

describe("writeIssueRuntimeState", () => {
  it("preserves local semantics when provider projection labels drift", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-runtime-write-"));

    try {
      const store = emptyIssueStateStore("devclaw");

      store.issues["123"] = issueState();
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const updated = await writeIssueRuntimeState({
        workspaceDir,
        project: { slug: "devclaw", channels: [] },
        issue: { iid: 123, labels: ["To Do", "tester:junior", "review:agent", "test:agent"] },
        providerType: ISSUE_PROVIDER.GITHUB,
        workflow: DEFAULT_WORKFLOW,
      });

      assert.equal(updated.assignedRole, "developer");
      assert.equal(updated.assignedLevel, "medior");
      assert.equal(updated.reviewPolicy, "human");
      assert.equal(updated.testPolicy, "skip");
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["123"]?.owner, "main");
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true });
    }
  });
});
