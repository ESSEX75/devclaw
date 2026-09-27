/** Verifies label-only integrity ownership, provider recovery, and audit isolation. */

import assert from "node:assert";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  UNVERIFIED_INTEGRITY_ERROR,
  STEP_ROUTING_COLOR,
  type IssueRuntimeState,
} from "../../domain/index.js";
import {
  readIssueStateStore,
  updateIssueStateStore,
  withIssueOrchestrationLock,
} from "../../state/index.js";
import {
  createEmptyIssueStateStoreForTesting as emptyIssueStateStore,
  replaceIssueStateStoreForTesting as writeIssueStateStore,
  TestProvider,
} from "../../testing/index.js";
import { reconcileManagedLabels } from "./index.js";

describe("managed projection coordinator", () => {
  it("preserves metadata and independent errors after label verification", async () => {
    await withFixture(async (workspaceDir, provider) => {
      await updateIssueStateStore(workspaceDir, "devclaw", store => {
        const state = store.issues["123"];
        return { store: { ...store, issues: { ...store.issues, "123": { ...state,
          integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
          integrityErrors: ["issue metadata is missing", "worker ownership conflict"],
        } } }, result: undefined };
      });
      await reconcileManagedLabels({ workspaceDir, projectSlug: "devclaw", issueId: 123,
        workflow: DEFAULT_WORKFLOW, provider, owner: "test" });
      const state = (await readIssueStateStore(workspaceDir, "devclaw")).issues["123"];
      assert.equal(state.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
      assert.deepEqual(state.integrityErrors, ["issue metadata is missing", "worker ownership conflict"]);
    });
  });

  it("does not turn an audit-directory failure into a projection failure", async t => {
    await withFixture(async (workspaceDir, provider) => {
      const mkdir = fs.mkdir;
      const mocked = t.mock.method(fs, "mkdir", (...args: Parameters<typeof fs.mkdir>) => {
        if (String(args[0]).endsWith(`${path.sep}log`)) throw new Error("audit storage unavailable");
        return mkdir(...args);
      });
      syncBuiltinESMExports();
      try {
        const result = await reconcileManagedLabels({ workspaceDir, projectSlug: "devclaw", issueId: 123,
          workflow: DEFAULT_WORKFLOW, provider, owner: "test" });
        assert.equal(result.auditError, "audit storage unavailable");
        const state = (await readIssueStateStore(workspaceDir, "devclaw")).issues["123"];
        assert.equal(state.integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
        assert.deepEqual(state.integrityErrors, []);
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
    });
  });

  it("clears only its own failure on retry and does not accumulate repeated failures", async () => {
    await withFixture(async (workspaceDir, provider) => {
      await updateIssueStateStore(workspaceDir, "devclaw", store => ({ store: { ...store,
        issues: { ...store.issues, "123": { ...store.issues["123"],
          integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, integrityErrors: ["metadata tamper"],
        } } }, result: undefined }));
      const failing = { getIssue: async () => { throw new Error("lookup failed"); },
        ensureLabel: provider.ensureLabel.bind(provider), addLabel: provider.addLabel.bind(provider), removeLabels: provider.removeLabels.bind(provider) };
      const input = { workspaceDir, projectSlug: "devclaw", issueId: 123, workflow: DEFAULT_WORKFLOW, owner: "retry" };
      await assert.rejects(reconcileManagedLabels({ ...input, provider: failing }), /lookup failed/);
      await assert.rejects(reconcileManagedLabels({ ...input, provider: failing }), /lookup failed/);
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["123"].integrityErrors.length, 2);
      const result = await reconcileManagedLabels({ ...input, provider });
      assert.deepEqual(result.integrity.integrityErrors, ["metadata tamper"]);
      assert.equal(result.integrity.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    });
  });

  it("preserves a new independent diagnostic written while provider I/O is in flight", async () => {
    await withFixture(async (workspaceDir, provider) => {
      let reads = 0;
      const concurrent = { getIssue: async (issueId: number) => {
        if (++reads === 2) await updateIssueStateStore(workspaceDir, "devclaw", store => ({ store: { ...store,
          issues: { ...store.issues, "123": { ...store.issues["123"], integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
            integrityErrors: ["concurrent metadata finding"] } } }, result: undefined }));
        return provider.getIssue(issueId);
      }, ensureLabel: provider.ensureLabel.bind(provider), addLabel: provider.addLabel.bind(provider), removeLabels: provider.removeLabels.bind(provider) };
      const result = await reconcileManagedLabels({ workspaceDir, projectSlug: "devclaw", issueId: 123,
        workflow: DEFAULT_WORKFLOW, provider: concurrent, owner: "test" });
      assert.deepEqual(result.integrity.integrityErrors, ["concurrent metadata finding"]);
      assert.equal(result.integrity.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    });
  });

  it("preserves an unclassified blocker across failure and successful retry", async () => {
    await withFixture(async (workspaceDir, provider) => {
      await updateIssueStateStore(workspaceDir, "devclaw", store => ({ store: { ...store,
        issues: { ...store.issues, "123": { ...store.issues["123"], integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR } } }, result: undefined }));
      const input = { workspaceDir, projectSlug: "devclaw", issueId: 123, workflow: DEFAULT_WORKFLOW, owner: "retry" };
      const failed = { getIssue: async () => { throw new Error("lookup failed"); },
        ensureLabel: provider.ensureLabel.bind(provider), addLabel: provider.addLabel.bind(provider), removeLabels: provider.removeLabels.bind(provider) };
      await assert.rejects(reconcileManagedLabels({ ...input, provider: failed }), /lookup failed/);
      const result = await reconcileManagedLabels({ ...input, provider });
      assert.equal(result.integrity.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
      assert.deepEqual(result.integrity.integrityErrors, [UNVERIFIED_INTEGRITY_ERROR]);
    });
  });

  it("projects custom role labels and policy colors while retaining unmanaged labels", async () => {
    await withFixture(async (workspaceDir, provider) => {
      await updateIssueStateStore(workspaceDir, "devclaw", store => ({ store: { ...store,
        issues: { ...store.issues, "123": { ...store.issues["123"], assignedRole: "security", assignedLevel: "expert", reviewPolicy: "agent", testPolicy: "skip" } } }, result: undefined }));
      provider.seedIssue({ iid: 123, labels: ["bug", "security:trainee", "team:payments"] });
      await reconcileManagedLabels({ workspaceDir, projectSlug: "devclaw", issueId: 123,
        workflow: DEFAULT_WORKFLOW, roles: ["security"], provider, owner: "custom" });
      const labels = (await provider.getIssue(123)).labels;
      assert.ok(labels.includes("security:expert"));
      assert.ok(labels.includes("team:payments"));
      assert.ok(!labels.includes("security:trainee"));
      assert.equal(provider.callsTo("ensureLabel").find(call => call.args.name === "review:agent")?.args.color, STEP_ROUTING_COLOR);
    });
  });

  it("waits for the issue lock, reconciles from fresh local state, and is idempotent", async () => {
    await withFixture(async (workspaceDir, provider) => {
      let release: (() => void) | undefined;
      let acquired: (() => void) | undefined;
      const mayRelease = new Promise<void>((resolve) => { release = resolve; });
      const lockReady = new Promise<void>((resolve) => { acquired = resolve; });
      const blocker = withIssueOrchestrationLock(workspaceDir, "devclaw", 123, async () => {
        acquired?.();
        await mayRelease;
        await updateIssueStateStore(workspaceDir, "devclaw", store => ({ store: { ...store,
          issues: { ...store.issues, "123": { ...store.issues["123"], owner: "fresh-owner" } } }, result: undefined }));
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

      assert.ok((await provider.getIssue(123)).labels.includes("owner:fresh-owner"));
      assert.equal(first.changed, true);
      assert.equal(second.changed, false);
      assert.deepEqual(first.before, ["Doing", "bug"]);
      assert.ok((await provider.getIssue(123)).labels.includes("bug"));
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["123"].integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
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
      const recovered = await reconcileManagedLabels({ workspaceDir, projectSlug: "devclaw", issueId: 123,
        workflow: DEFAULT_WORKFLOW, provider, owner: "retry" });
      assert.equal(recovered.integrity.integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
      assert.deepEqual(recovered.integrity.integrityErrors, []);
    });
  });

  it("rejects a silent provider no-op during read-back verification", async () => {
    await withFixture(async (workspaceDir, provider) => {
      const ineffectiveProvider = {
        getIssue: (issueId: number) => provider.getIssue(issueId),
        ensureLabel: (name: string, color: string) => provider.ensureLabel(name, color),
        async addLabel(): Promise<void> { /* simulate a successful response without mutation */ },
        async removeLabels(): Promise<void> { /* simulate a successful response without mutation */ },
      };

      await assert.rejects(reconcileManagedLabels({
        workspaceDir, projectSlug: "devclaw", issueId: 123,
        workflow: DEFAULT_WORKFLOW, roles: ["developer"],
        provider: ineffectiveProvider, owner: "test_noop",
      }), /still differ/);
      const state = (await readIssueStateStore(workspaceDir, "devclaw")).issues["123"];

      assert.equal(state.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    });
  });
});

/** Isolate persisted state and a deterministic provider for each coordinator scenario.
 * @param run - Scenario executed before temporary storage is removed.
 */
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

/** Build a healthy initialized issue whose provider labels initially drift. */
function issueState(): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "junior",
    owner: null,
    reviewPolicy: null,
    testPolicy: null,
    notifyTarget: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    closedAt: null,
    providerMissing: null,
    pipelineNotification: null,
  };
}
