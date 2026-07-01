import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore, type IssueRuntimeState } from "../../issues/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../../domain/workflow/index.js";
import { extractIssueMetadata } from "../../projection/index.js";
import { repairIssueProjection, repairIssueFromLocalState } from "./issue-repair.js";

function state(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: "github",
    managed: true,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    owner: "main",
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: { channel: "telegram", name: "primary" },
    branchContract: null,
    activeWorker: null,
    integrityStatus: "integrity_error",
    integrityErrors: ["metadata tamper"],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

async function seedStore(tmpDir: string, issueState = state()): Promise<void> {
  const store = emptyIssueStateStore("devclaw");
  store.issues[String(issueState.issueId)] = issueState;
  await writeIssueStateStore(tmpDir, "devclaw", store);
}

describe("issue repair", () => {
  it("dry-run reports planned changes without provider or local writes", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-repair-"));
    try {
      await seedStore(tmpDir);
      const provider = new TestProvider();
      provider.seedIssue({ iid: 123, labels: ["Doing", "bug"], description: "Body" });

      const result = await repairIssueProjection({
        workspaceDir: tmpDir,
        project: { slug: "devclaw" },
        issueId: 123,
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        dryRun: true,
      });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(result.dryRun, true);
      assert.ok(result.diff.missingManagedLabels.includes("To Do"));
      assert.ok(result.diff.unexpectedManagedLabels.includes("Doing"));
      assert.strictEqual(result.metadataAction, "replace");
      assert.strictEqual(provider.callsTo("addLabel").length, 0);
      assert.strictEqual(provider.callsTo("removeLabels").length, 0);
      assert.strictEqual(provider.callsTo("editIssue").length, 0);
      assert.strictEqual(loaded.issues["123"]!.integrityStatus, "integrity_error");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("repairs labels, metadata, and clears integrity error", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-repair-"));
    try {
      await seedStore(tmpDir);
      const provider = new TestProvider();
      provider.seedIssue({ iid: 123, labels: ["Doing", "bug"], description: "Body" });

      const result = await repairIssueProjection({
        workspaceDir: tmpDir,
        project: { slug: "devclaw" },
        issueId: 123,
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
      });
      const issue = await provider.getIssue(123);
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(result.integrityStatus, "ok");
      assert.ok(issue.labels.includes("To Do"));
      assert.ok(issue.labels.includes("bug"));
      assert.ok(!issue.labels.includes("Doing"));
      assert.deepStrictEqual(extractIssueMetadata(issue.description), {
        projectSlug: "devclaw",
        issueId: 123,
        projectionVersion: 1,
      });
      assert.strictEqual(loaded.issues["123"]!.integrityStatus, "ok");
      assert.deepStrictEqual(loaded.issues["123"]!.integrityErrors, []);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("rejects provider repair source", async () => {
    await assert.rejects(
      repairIssueFromLocalState({
        workspaceDir: "/tmp/unused",
        projectSlug: "devclaw",
        issueId: 123,
        source: "provider",
        runCommand: async () => {
          throw new Error("runCommand should not be called for unsupported provider repair source");
        },
      }),
      /Repair from provider is not supported because provider projection is not authoritative/,
    );
  });
});
