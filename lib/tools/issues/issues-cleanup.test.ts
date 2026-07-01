import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore, type IssueRuntimeState } from "../../state/issues/index.js";
import { cleanupIssueState } from "./issues-cleanup.js";

function issue(overrides: Partial<IssueRuntimeState>): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 1,
    provider: "github",
    managed: true,
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
    integrityStatus: "ok",
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
      store.issues["3"] = issue({ issueId: 3, integrityStatus: "integrity_error" });
      store.issues["4"] = issue({
        issueId: 4,
        activeWorker: { role: "developer", level: "medior", slotIndex: 0, sessionKey: "s", startedAt: "2026-05-01T00:00:00.000Z" },
      });
      store.issues["5"] = issue({ issueId: 5, workflowState: "blocked" });
      await writeIssueStateStore(tmpDir, "devclaw", store);

      const result = await cleanupIssueState({ workspaceDir: tmpDir, projectSlug: "devclaw", olderThan: "30d" });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.deepStrictEqual(result.archived, [1]);
      assert.ok(loaded.archive.issues["1"]);
      assert.strictEqual(loaded.archive.issues["1"]!.finalWorkflowState, "done");
      assert.strictEqual(loaded.issues["1"], undefined);
      assert.ok(loaded.issues["2"]);
      assert.ok(loaded.issues["3"]);
      assert.ok(loaded.issues["4"]);
      assert.ok(loaded.issues["5"]);
      await assert.rejects(fs.stat(path.join(tmpDir, "devclaw", "projects", "devclaw", "issues.archive.jsonl")));
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
