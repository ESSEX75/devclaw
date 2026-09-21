/**
 * Tests for project-local issue runtime state.
 * Run with: npx tsx --test lib/state/issues/issues.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  PIPELINE_NOTIFICATION_STATUS,
  type IssueRuntimeState,
} from "../../domain/index.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../paths.js";
import {
  ARCHIVED_ISSUES_FILE_NAME,
  ISSUE_CREATIONS_FILE_NAME,
  PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS,
} from "./const.js";
import {
  confirmPipelineNotification,
  readIssueArchiveStore,
  readIssueCreationStore,
  resetIssueStores,
  readIssueStateStore,
  reservePipelineNotification,
  updateIssueCreationStore,
  updateIssueStateStore,
  writeIssueRoleLevel,
} from "./index.js";
import { emptyIssueStateStore, issueStatePath, writeIssueStateStore } from "./active/repository.js";
import { parseIssueStateStore } from "./active/schema.js";
import { emptyIssueArchiveStore } from "./archive/repository.js";
import { parseIssueArchiveStore } from "./archive/schema.js";
import { emptyIssueCreationStore } from "./creation/repository.js";
import { parseIssueCreationStore } from "./creation/schema.js";

/**
 * Build one complete active issue fixture with optional field overrides.
 *
 * @param overrides - Fixture fields replacing the current-contract defaults.
 */
function issue(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
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
    ...overrides,
  };
}

describe("issue state store", () => {
  it("keeps a missing creation store in memory until a locked update persists it", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issue-creations-"));
    const filePath = path.join(
      tmpDir,
      DATA_DIR,
      PROJECTS_DIRECTORY_NAME,
      "devclaw",
      ISSUE_CREATIONS_FILE_NAME,
    );

    try {
      const store = await readIssueCreationStore(tmpDir, "devclaw");

      assert.deepStrictEqual(store, emptyIssueCreationStore("devclaw"));
      await assert.rejects(fs.access(filePath), { code: "ENOENT" });

      await updateIssueCreationStore(tmpDir, "devclaw", (current) => ({
        store: { ...current, operations: { ...current.operations } },
        result: undefined,
      }));

      assert.deepStrictEqual(
        JSON.parse(await fs.readFile(filePath, "utf-8")),
        emptyIssueCreationStore("devclaw"),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("returns an in-memory active store without writing when missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = await readIssueStateStore(tmpDir, "devclaw");
      const filePath = issueStatePath(tmpDir, "devclaw");

      assert.deepStrictEqual(store, emptyIssueStateStore("devclaw"));
      await assert.rejects(fs.access(filePath), { code: "ENOENT" });
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
        projectSlug: "devclaw",
        issues: {
          "123": issue(),
        },
      }), "utf-8");

      const store = await readIssueStateStore(tmpDir, "devclaw");
      assert.strictEqual(store.projectSlug, "devclaw");
      assert.strictEqual(store.issues["123"]!.workflowState, "todo");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("rejects retired fields and missing current nullable values", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const filePath = issueStatePath(tmpDir, "devclaw");
      const persistedIssue: Record<string, unknown> = {
        ...issue(),
        branchContract: { branch: "feature/123" },
        retryAt: "2026-06-23T00:00:00.000Z",
        retriesRemaining: 1,
      };

      delete persistedIssue.owner;
      delete persistedIssue.pipelineNotification;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        projectSlug: "devclaw",
        issues: { "123": persistedIssue },
      }), "utf-8");

      await assert.rejects(readIssueStateStore(tmpDir, "devclaw"), /Cannot read active issue store/);
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
        const state = issue();

        return { store: { ...store, issues: { ...store.issues, "123": state } }, result: state.workflowState };
      });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(returned, "todo");
      assert.strictEqual(loaded.issues["123"]!.issueId, 123);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("updates the managed role and level together", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["123"] = issue({ assignedRole: "developer", assignedLevel: "senior" });
      await writeIssueStateStore(tmpDir, "devclaw", store);

      const updated = await writeIssueRoleLevel(tmpDir, "devclaw", 123, "tester", "junior");
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(updated.assignedRole, "tester");
      assert.strictEqual(updated.assignedLevel, "junior");
      assert.strictEqual(loaded.issues["123"]!.assignedRole, "tester");
      assert.strictEqual(loaded.issues["123"]!.assignedLevel, "junior");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("reserves and confirms one terminal pipeline notification", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["123"] = issue({ workflowState: "done", workflowLabel: "Done" });
      await writeIssueStateStore(tmpDir, "devclaw", store);

      assert.strictEqual(
        await reservePipelineNotification(tmpDir, "devclaw", 123, "pipelineComplete:done"),
        true,
      );
      assert.strictEqual(
        await reservePipelineNotification(tmpDir, "devclaw", 123, "pipelineComplete:done"),
        false,
      );

      await confirmPipelineNotification(tmpDir, "devclaw", 123, "pipelineComplete:done");
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(
        loaded.issues["123"]!.pipelineNotification?.status,
        PIPELINE_NOTIFICATION_STATUS.DELIVERED,
      );
      assert.ok(loaded.issues["123"]!.pipelineNotification?.deliveredAt);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("retries an unconfirmed pipeline notification only after its attempt lease expires", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    const firstAttempt = new Date("2026-06-22T00:00:00.000Z");

    try {
      await updateIssueStateStore(tmpDir, "devclaw", (store) => ({
        store: { ...store, issues: { "123": issue() } },
        result: undefined,
      }));

      assert.equal(
        await reservePipelineNotification(tmpDir, "devclaw", 123, "pipelineComplete:done", firstAttempt),
        true,
      );
      assert.equal(
        await reservePipelineNotification(
          tmpDir,
          "devclaw",
          123,
          "pipelineComplete:done",
          new Date(firstAttempt.getTime() + PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS - 1),
        ),
        false,
      );
      assert.equal(
        await reservePipelineNotification(
          tmpDir,
          "devclaw",
          123,
          "pipelineComplete:done",
          new Date(firstAttempt.getTime() + PIPELINE_NOTIFICATION_ATTEMPT_LEASE_MS),
        ),
        true,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("rejects role-level writes for an uninitialized issue", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      await assert.rejects(
        writeIssueRoleLevel(tmpDir, "devclaw", 404, "developer", "junior"),
        /Issue #404 has no initialized local runtime state/,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("returns an in-memory archive without writing when missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const archive = await readIssueArchiveStore(tmpDir, "devclaw");
      const archivePath = path.join(
        tmpDir,
        DATA_DIR,
        PROJECTS_DIRECTORY_NAME,
        "devclaw",
        ARCHIVED_ISSUES_FILE_NAME,
      );

      assert.deepStrictEqual(archive, emptyIssueArchiveStore("devclaw"));
      await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("resets both stores only through the explicit reset operation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["123"] = issue();
      await writeIssueStateStore(tmpDir, "devclaw", store);
      await resetIssueStores(tmpDir, "devclaw");
      assert.deepStrictEqual(await readIssueStateStore(tmpDir, "devclaw"), emptyIssueStateStore("devclaw"));
      assert.deepStrictEqual(await readIssueArchiveStore(tmpDir, "devclaw"), emptyIssueArchiveStore("devclaw"));
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
        projectSlug: "other",
        issues: {},
      }), "utf-8");

      await assert.rejects(
        readIssueStateStore(tmpDir, "devclaw"),
        /Issue store projectSlug mismatch: expected devclaw, got other/,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("rejects active records whose key or nested project identity disagrees with the envelope", () => {
    assert.throws(
      () => parseIssueStateStore({
        projectSlug: "devclaw",
        issues: { "999": issue() },
      }, "devclaw"),
      /Issue store key mismatch/,
    );
    assert.throws(
      () => parseIssueStateStore({
        projectSlug: "devclaw",
        issues: { "123": issue({ projectSlug: "other-project" }) },
      }, "devclaw"),
      /Issue #123 projectSlug mismatch/,
    );
  });

  it("rejects archive records whose key or nested project identity disagrees with the envelope", () => {
    const record = {
      projectSlug: "devclaw",
      issueId: 123,
      provider: ISSUE_PROVIDER.GITHUB,
      finalWorkflowState: "done",
      archiveReason: "terminal",
      archivedAt: "2026-06-22T00:00:00.000Z",
      lastIntegrityStatus: ISSUE_INTEGRITY_STATUS.OK,
      attachmentDisposition: "none",
      sourceSnapshotHash: "a".repeat(64),
    };

    assert.throws(
      () => parseIssueArchiveStore({
        projectSlug: "devclaw",
        issues: { "github:devclaw:999": record },
      }, "devclaw"),
      /Issue archive key mismatch/,
    );
    assert.throws(
      () => parseIssueArchiveStore({
        projectSlug: "devclaw",
        issues: { "github:other-project:123": { ...record, projectSlug: "other-project" } },
      }, "devclaw"),
      /Archived issue #123 projectSlug mismatch/,
    );
  });

  it("rejects creation operations whose key or nested project identity disagrees with the envelope", () => {
    const operation = {
      operationId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "request-123",
      payloadHash: "b".repeat(64),
      projectSlug: "devclaw",
      requestedBy: "tester",
      requestedAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
      status: "creating",
      input: {
        title: "Issue",
        body: "Body",
        assignees: [],
        workflowState: "todo",
        workflowLabel: "To Do",
        assignedRole: "developer",
        assignedLevel: "medior",
        owner: "main",
        reviewPolicy: "human",
        testPolicy: "skip",
        notifyTarget: null,
        provider: ISSUE_PROVIDER.GITHUB,
      },
      expectedLabels: ["To Do"],
      completedSteps: [],
      pendingSteps: [],
      attempts: 0,
      auditCorrelationId: "22222222-2222-4222-8222-222222222222",
    };

    assert.throws(
      () => parseIssueCreationStore({
        projectSlug: "devclaw",
        operations: { "wrong-key": operation },
      }, "devclaw"),
      /Issue creation key mismatch/,
    );
    assert.throws(
      () => parseIssueCreationStore({
        projectSlug: "devclaw",
        operations: { "request-123": { ...operation, projectSlug: "other-project" } },
      }, "devclaw"),
      /Issue creation operation projectSlug mismatch/,
    );
  });

  it("serializes concurrent updates through the lock", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-issues-"));
    try {
      await Promise.all([
        updateIssueStateStore(tmpDir, "devclaw", async (store) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            store: { ...store, issues: { ...store.issues, "101": issue({ issueId: 101 }) } },
            result: undefined,
          };
        }),
        updateIssueStateStore(tmpDir, "devclaw", async (store) => {
          return {
            store: { ...store, issues: { ...store.issues, "102": issue({ issueId: 102 }) } },
            result: undefined,
          };
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

