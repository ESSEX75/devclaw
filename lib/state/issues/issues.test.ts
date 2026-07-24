/**
 * Tests for project-local issue runtime state.
 * Run with: npx tsx --test lib/state/issues/issues.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import {
  emptyIssueStateStore,
  issueStatePath,
  readIssueStateStore,
  updateIssueStateStore,
  writeIssueStateStore,
} from "./index.js";

function issue(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    managed: true,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    owner: "main",
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: null,
    branchContract: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("issue state store", () => {
  it("creates an empty project-local issues.json when missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = await readIssueStateStore(tmpDir, "devclaw");
      const filePath = issueStatePath(tmpDir, "devclaw");

      assert.deepStrictEqual(store, emptyIssueStateStore("devclaw"));
      assert.strictEqual(await fs.readFile(filePath, "utf-8"), JSON.stringify(store, null, 2) + "\n");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("reads an existing issues.json", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const filePath = issueStatePath(tmpDir, "devclaw");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        version: 1,
        projectSlug: "devclaw",
        issues: {
          "123": issue(),
        },
        archive: {
          issues: {},
        },
      }), "utf-8");

      const store = await readIssueStateStore(tmpDir, "devclaw");
      assert.strictEqual(store.projectSlug, "devclaw");
      assert.strictEqual(store.issues["123"]!.workflowState, "todo");
      assert.deepStrictEqual(store.archive.issues, {});
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("writes issue state and preserves projectSlug", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["123"] = issue();

      await writeIssueStateStore(tmpDir, "devclaw", store);
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(loaded.projectSlug, "devclaw");
      assert.strictEqual(loaded.issues["123"]!.projectSlug, "devclaw");
      assert.strictEqual(loaded.issues["123"]!.workflowLabel, "To Do");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("supports update-by-callback under lock", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const returned = await updateIssueStateStore(tmpDir, "devclaw", (store) => {
        store.issues["123"] = issue();
        return store.issues["123"]!.workflowState;
      });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(returned, "todo");
      assert.strictEqual(loaded.issues["123"]!.issueId, 123);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("preserves archive.issues", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.archive.issues["77"] = {
        issueId: 77,
        finalWorkflowState: "done",
        closedAt: "2026-06-01T00:00:00.000Z",
        archivedAt: "2026-06-22T00:00:00.000Z",
        lastIntegrityStatus: ISSUE_INTEGRITY_STATUS.OK,
      };

      await writeIssueStateStore(tmpDir, "devclaw", store);
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(loaded.archive.issues["77"]!.finalWorkflowState, "done");
      assert.deepStrictEqual(loaded.issues, {});
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("rejects projectSlug mismatch with deterministic error", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const filePath = issueStatePath(tmpDir, "devclaw");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        version: 1,
        projectSlug: "other",
        issues: {},
        archive: { issues: {} },
      }), "utf-8");

      await assert.rejects(
        readIssueStateStore(tmpDir, "devclaw"),
        /issues\.json projectSlug mismatch: expected devclaw, got other/,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("serializes concurrent updates through the lock", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      await Promise.all([
        updateIssueStateStore(tmpDir, "devclaw", async (store) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          store.issues["101"] = issue({ issueId: 101 });
        }),
        updateIssueStateStore(tmpDir, "devclaw", async (store) => {
          store.issues["102"] = issue({ issueId: 102 });
        }),
      ]);

      const loaded = await readIssueStateStore(tmpDir, "devclaw");
      assert.strictEqual(loaded.issues["101"]!.issueId, 101);
      assert.strictEqual(loaded.issues["102"]!.issueId, 102);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

