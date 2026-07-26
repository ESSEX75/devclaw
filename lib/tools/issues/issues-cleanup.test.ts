import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore } from "../../state/issues/index.js";
import {
  DEFAULT_WORKFLOW,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
  WORKFLOW_STATE_KEYS,
} from "../../domain/index.js";
import { cleanupIssueState } from "./issues-cleanup.js";

function issue(overrides: Partial<IssueRuntimeState>): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 1,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "done",
    workflowLabel: "Done",
    assignedRole: null,
    assignedLevel: null,
    owner: "main",
    reviewPolicy: null,
    testPolicy: null,
    notifyTarget: null,
    branchContract: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    closedAt: "2026-05-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("issues cleanup", () => {
  it("archives only eligible old closed issues into inline archive.issues", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-cleanup-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["1"] = issue({ issueId: 1 });
      store.issues["2"] = issue({ issueId: 2, closedAt: new Date().toISOString() });
      store.issues["3"] = issue({
        issueId: 3,
        integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
      });
      store.issues["4"] = issue({
        issueId: 4,
        activeWorker: { role: "developer", level: "medior", slotIndex: 0, sessionKey: "s", startedAt: "2026-05-01T00:00:00.000Z" },
      });
      store.issues["5"] = issue({ issueId: 5, workflowState: WORKFLOW_STATE_KEYS.DOING });
      store.issues["6"] = issue({ issueId: 6, workflowState: "toReview", workflowLabel: "To Review" });
      store.issues["7"] = issue({ issueId: 7, workflowState: "rejected", workflowLabel: "Rejected" });
      await writeIssueStateStore(tmpDir, "devclaw", store);

      const result = await cleanupIssueState({ workspaceDir: tmpDir, projectSlug: "devclaw", olderThan: "30d" });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.deepStrictEqual(result.archived, [1, 7]);
      assert.ok(loaded.archive.issues["1"]);
      assert.strictEqual(loaded.archive.issues["1"]!.finalWorkflowState, "done");
      assert.ok(loaded.archive.issues["7"]);
      assert.strictEqual(loaded.archive.issues["7"]!.finalWorkflowState, "rejected");
      assert.strictEqual(loaded.issues["1"], undefined);
      assert.strictEqual(loaded.issues["7"], undefined);
      assert.ok(loaded.issues["2"]);
      assert.ok(loaded.issues["3"]);
      assert.ok(loaded.issues["4"]);
      assert.ok(loaded.issues["5"]);
      assert.ok(loaded.issues["6"]);
      await assert.rejects(fs.stat(path.join(tmpDir, "devclaw", "projects", "devclaw", "issues.archive.jsonl")));
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("is idempotent when cleanup runs more than once", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-cleanup-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["1"] = issue({ issueId: 1 });
      await writeIssueStateStore(tmpDir, "devclaw", store);

      const first = await cleanupIssueState({ workspaceDir: tmpDir, projectSlug: "devclaw", olderThan: "30d" });
      const second = await cleanupIssueState({ workspaceDir: tmpDir, projectSlug: "devclaw", olderThan: "30d" });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.deepStrictEqual(first.archived, [1]);
      assert.deepStrictEqual(second.archived, []);
      assert.deepStrictEqual(second.skipped, []);
      assert.deepStrictEqual(Object.keys(loaded.archive.issues), ["1"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
