import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore, type IssueRuntimeState } from "../../state/issues/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../../domain/workflow/index.js";
import { extractIssueMetadata } from "../../projection/index.js";
import { migrateIssuePolicies, repairIssueProjection, repairIssueFromLocalState } from "./issue-repair.js";
import { createTestHarness } from "../../testing/index.js";

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
  const store = emptyIssueStateStore(issueState.projectSlug);
  store.issues[String(issueState.issueId)] = issueState;
  await writeIssueStateStore(tmpDir, issueState.projectSlug, store);
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

  it("dry-runs policy migration without local or provider writes", async () => {
    const h = await createTestHarness();
    try {
      await seedStore(h.workspaceDir, state({
        projectSlug: h.project.slug,
        issueId: 75,
        workflowState: "toReview",
        workflowLabel: "To Review",
        reviewPolicy: "human",
        testPolicy: "skip",
      }));
      h.provider.seedIssue({ iid: 75, labels: ["To Review", "review:human", "test:skip"], description: "Body" });

      const result = await migrateIssuePolicies({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        reviewPolicy: "agent",
        testPolicy: "agent",
        issueIds: [75],
        dryRun: true,
        provider: h.provider,
        runCommand: h.runCommand,
      });
      const loaded = await readIssueStateStore(h.workspaceDir, h.project.slug);

      assert.strictEqual(result.dryRun, true);
      assert.deepStrictEqual(result.changed.map((change) => change.issueId), [75]);
      assert.strictEqual(result.changed[0]!.before.reviewPolicy, "human");
      assert.strictEqual(result.changed[0]!.after.reviewPolicy, "agent");
      assert.strictEqual(loaded.issues["75"]!.reviewPolicy, "human");
      assert.strictEqual(loaded.issues["75"]!.testPolicy, "skip");
      assert.strictEqual(h.provider.callsTo("addLabel").length, 0);
      assert.strictEqual(h.provider.callsTo("removeLabels").length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("applies policy migration through local state first and provider projection second", async () => {
    const h = await createTestHarness();
    try {
      await seedStore(h.workspaceDir, state({
        projectSlug: h.project.slug,
        issueId: 75,
        workflowState: "toReview",
        workflowLabel: "To Review",
        reviewPolicy: "human",
        testPolicy: "skip",
        integrityStatus: "ok",
        integrityErrors: [],
      }));
      h.provider.seedIssue({ iid: 75, labels: ["To Review", "review:human", "test:skip"], description: "Body" });

      const result = await migrateIssuePolicies({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        reviewPolicy: "agent",
        testPolicy: "agent",
        issueIds: [75],
        provider: h.provider,
        runCommand: h.runCommand,
      });
      const loaded = await readIssueStateStore(h.workspaceDir, h.project.slug);
      const issue = await h.provider.getIssue(75);

      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.changed.map((change) => change.issueId), [75]);
      assert.strictEqual(loaded.issues["75"]!.reviewPolicy, "agent");
      assert.strictEqual(loaded.issues["75"]!.testPolicy, "agent");
      assert.ok(issue.labels.includes("review:agent"), `Labels: ${issue.labels}`);
      assert.ok(issue.labels.includes("test:agent"), `Labels: ${issue.labels}`);
      assert.ok(!issue.labels.includes("review:human"), `Labels: ${issue.labels}`);
      assert.ok(!issue.labels.includes("test:skip"), `Labels: ${issue.labels}`);
    } finally {
      await h.cleanup();
    }
  });

  it("skips closed policy migrations by default", async () => {
    const h = await createTestHarness();
    try {
      await seedStore(h.workspaceDir, state({
        projectSlug: h.project.slug,
        issueId: 73,
        workflowState: "done",
        workflowLabel: "Done",
        closedAt: "2026-07-02T00:00:00.000Z",
        reviewPolicy: "human",
        testPolicy: "skip",
      }));

      const result = await migrateIssuePolicies({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        reviewPolicy: "agent",
        testPolicy: "agent",
        runCommand: h.runCommand,
      });
      const loaded = await readIssueStateStore(h.workspaceDir, h.project.slug);

      assert.deepStrictEqual(result.changed, []);
      assert.deepStrictEqual(result.skipped, [{ issueId: 73, reason: "closed" }]);
      assert.strictEqual(loaded.issues["73"]!.reviewPolicy, "human");
      assert.strictEqual(loaded.issues["73"]!.testPolicy, "skip");
    } finally {
      await h.cleanup();
    }
  });

  it("repairs provider-only policy label drift back to local policy truth", async () => {
    const h = await createTestHarness();
    try {
      await seedStore(h.workspaceDir, state({
        projectSlug: h.project.slug,
        issueId: 80,
        workflowState: "toReview",
        workflowLabel: "To Review",
        reviewPolicy: "human",
        testPolicy: "skip",
        integrityStatus: "ok",
        integrityErrors: [],
      }));
      h.provider.seedIssue({ iid: 80, labels: ["To Review", "review:agent", "test:agent"], description: "Body" });

      await repairIssueProjection({
        workspaceDir: h.workspaceDir,
        project: { slug: h.project.slug },
        issueId: 80,
        provider: h.provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer", "reviewer", "tester"],
      });
      const issue = await h.provider.getIssue(80);

      assert.ok(issue.labels.includes("review:human"), `Labels: ${issue.labels}`);
      assert.ok(issue.labels.includes("test:skip"), `Labels: ${issue.labels}`);
      assert.ok(!issue.labels.includes("review:agent"), `Labels: ${issue.labels}`);
      assert.ok(!issue.labels.includes("test:agent"), `Labels: ${issue.labels}`);
    } finally {
      await h.cleanup();
    }
  });
});
