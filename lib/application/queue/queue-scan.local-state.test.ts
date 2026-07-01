import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, writeIssueStateStore, type IssueRuntimeState } from "../../state/issues/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../../domain/workflow/index.js";
import { findNextIssueForRole } from "./scan.js";

function state(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: "github",
    managed: true,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "senior",
    owner: null,
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: null,
    branchContract: null,
    activeWorker: null,
    integrityStatus: "ok",
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

async function withStore<T>(states: IssueRuntimeState[], fn: (tmpDir: string, provider: TestProvider) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-scan-"));
  const provider = new TestProvider();
  try {
    const store = emptyIssueStateStore("devclaw");
    for (const issueState of states) {
      store.issues[String(issueState.issueId)] = issueState;
    }
    await writeIssueStateStore(tmpDir, "devclaw", store);
    return await fn(tmpDir, provider);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("findNextIssueForRole local state", () => {
  it("dispatches initialized managed issues from local workflow state", async () => {
    await withStore([state()], async (tmpDir, provider) => {
      provider.seedIssue({ iid: 123, labels: ["Doing", "human:label"], description: "Body" });

      const next = await findNextIssueForRole(
        provider,
        "developer",
        DEFAULT_WORKFLOW,
        undefined,
        { workspaceDir: tmpDir, projectSlug: "devclaw" },
      );

      assert.strictEqual(next?.issue.iid, 123);
      assert.strictEqual(next?.label, "To Do");
      assert.strictEqual(next?.localState?.assignedLevel, "senior");
      assert.strictEqual(provider.callsTo("listIssuesByLabel").length, 0);
    });
  });

  it("skips initialized managed issues with integrity_error", async () => {
    await withStore([state({ integrityStatus: "integrity_error", integrityErrors: ["tamper"] })], async (tmpDir, provider) => {
      provider.seedIssue({ iid: 123, labels: ["To Do"], description: "Body" });

      const next = await findNextIssueForRole(
        provider,
        "developer",
        DEFAULT_WORKFLOW,
        undefined,
        { workspaceDir: tmpDir, projectSlug: "devclaw" },
      );

      assert.strictEqual(next, null);
    });
  });

  it("does not silently dispatch provider-only issues in managed local-state mode", async () => {
    await withStore([], async (tmpDir, provider) => {
      provider.seedIssue({ iid: 456, labels: ["To Do", "bug"], description: "Legacy body" });

      const next = await findNextIssueForRole(
        provider,
        "developer",
        DEFAULT_WORKFLOW,
        undefined,
        { workspaceDir: tmpDir, projectSlug: "devclaw" },
      );

      assert.strictEqual(next, null);
      assert.strictEqual(provider.callsTo("listIssuesByLabel").length, 0);
    });
  });
});
