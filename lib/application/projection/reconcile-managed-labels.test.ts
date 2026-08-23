import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
} from "../../domain/index.js";
import {
  emptyIssueStateStore,
  readIssueStateStore,
  withIssueOrchestrationLock,
  writeIssueStateStore,
} from "../../state/issues/index.js";
import { TestProvider } from "../../testing/index.js";
import { reconcileManagedLabels } from "./reconcile-managed-labels.js";

describe("managed projection coordinator", () => {
  it("waits for the issue lock, reconciles from fresh local state, and is idempotent", async () => {
    await withFixture(async (workspaceDir, provider) => {
      let release: (() => void) | undefined;
      let acquired: (() => void) | undefined;
      const mayRelease = new Promise<void>((resolve) => { release = resolve; });
      const lockReady = new Promise<void>((resolve) => { acquired = resolve; });
      const blocker = withIssueOrchestrationLock(workspaceDir, "devclaw", 123, async () => {
        acquired?.();
        await mayRelease;
      });
      await lockReady;

      const reconciliation = reconcileManagedLabels({
        workspaceDir,
        projectSlug: "devclaw",
        issueId: 123,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        provider,
        owner: "test",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(provider.callsTo("addLabel").length, 0);

      release?.();
      await blocker;
      const first = await reconciliation;
      const second = await reconcileManagedLabels({
        workspaceDir,
        projectSlug: "devclaw",
        issueId: 123,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        provider,
        owner: "test",
      });

      assert.equal(first.changed, true);
      assert.equal(second.changed, false);
    });
  });

  it("records integrity_error after a partial provider failure", async () => {
    await withFixture(async (workspaceDir, provider) => {
      const failingProvider = {
        getIssue: (issueId: number) => provider.getIssue(issueId),
        ensureLabel: (name: string, color: string) => provider.ensureLabel(name, color),
        addLabel: (issueId: number, label: string) => provider.addLabel(issueId, label),
        async removeLabels(): Promise<void> {
          throw new Error("provider unavailable");
        },
      };

      await assert.rejects(reconcileManagedLabels({
        workspaceDir,
        projectSlug: "devclaw",
        issueId: 123,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        provider: failingProvider,
        owner: "test_failure",
      }), /provider unavailable/);

      const store = await readIssueStateStore(workspaceDir, "devclaw");
      assert.equal(store.issues["123"]?.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
      assert.match(store.issues["123"]?.integrityErrors[0] ?? "", /test_failure/);
    });
  });
});

async function withFixture(run: (workspaceDir: string, provider: TestProvider) => Promise<void>): Promise<void> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-managed-projection-"));
  const provider = new TestProvider();
  const store = emptyIssueStateStore("devclaw");
  store.issues["123"] = issueState();
  await writeIssueStateStore(workspaceDir, "devclaw", store);
  provider.seedIssue({ iid: 123, labels: ["Doing", "bug"] });

  try {
    await run(workspaceDir, provider);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

function issueState(): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "junior",
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
