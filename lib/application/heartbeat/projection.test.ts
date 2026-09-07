import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyIssueStateStore, readIssueArchiveStore, readIssueStateStore, writeIssueStateStore } from "../../state/issues/index.js";
import { renderIssueMetadata } from "../../projection/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { PROVIDER_ISSUE_LOOKUP_ERROR, ProviderIssueLookupError } from "../../integrations/providers/index.js";
import { ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import { DEFAULT_WORKFLOW } from "../../domain/index.js";
import { projectionIntegrityPass } from "./projection.js";

function state(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
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
    branchContract: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

async function withStore<T>(issueState: IssueRuntimeState, fn: (tmpDir: string, provider: TestProvider) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-projection-"));
  const provider = new TestProvider();
  try {
    const store = emptyIssueStateStore("devclaw");
    store.issues[String(issueState.issueId)] = issueState;
    await writeIssueStateStore(tmpDir, "devclaw", store);
    return await fn(tmpDir, provider);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function metadata(issueId = 123): string {
  return renderIssueMetadata({ projectSlug: "devclaw", issueId, projectionVersion: 1 });
}

describe("projectionIntegrityPass", () => {
  it("keeps local state for authorization failures", async () => {
    class UnauthorizedProvider extends TestProvider {
      override async getIssue(issueId: number): Promise<Awaited<ReturnType<TestProvider["getIssue"]>>> {
        throw new ProviderIssueLookupError({
          code: PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED,
          provider: "github",
          retryable: false,
          status: 401,
          message: `Unauthorized lookup for #${issueId}`,
        });
      }
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-projection-auth-"));
    try {
      const store = emptyIssueStateStore("devclaw");
      store.issues["123"] = state();
      await writeIssueStateStore(tmpDir, "devclaw", store);
      const result = await projectionIntegrityPass({
        workspaceDir: tmpDir, project: { slug: "devclaw" }, provider: new UnauthorizedProvider(),
        workflow: DEFAULT_WORKFLOW, roles: ["developer"],
      });
      assert.equal(result.errors, 1);
      assert.ok((await readIssueStateStore(tmpDir, "devclaw")).issues["123"]);
      assert.equal(Object.keys((await readIssueArchiveStore(tmpDir, "devclaw")).issues).length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("restores missing managed labels and removes unexpected managed labels", async () => {
    await withStore(state(), async (tmpDir, provider) => {
      provider.seedIssue({
        iid: 123,
        labels: ["Doing", "bug", "owner:main", "review:human", "test:skip"],
        description: `Body\n\n${metadata()}`,
      });

      const result = await projectionIntegrityPass({
        workspaceDir: tmpDir,
        project: { slug: "devclaw" },
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
      });
      const issue = await provider.getIssue(123);

      assert.strictEqual(result.repaired, 1);
      assert.ok(issue.labels.includes("To Do"));
      assert.ok(issue.labels.includes("bug"));
      assert.ok(!issue.labels.includes("Doing"));
    });
  });

  it("sets integrity_error when metadata is missing", async () => {
    await withStore(state(), async (tmpDir, provider) => {
      provider.seedIssue({ iid: 123, labels: ["To Do"], description: "Body" });

      const result = await projectionIntegrityPass({
        workspaceDir: tmpDir,
        project: { slug: "devclaw" },
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
      });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(result.errors, 1);
      assert.strictEqual(loaded.issues["123"]!.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
      assert.deepStrictEqual(loaded.issues["123"]!.integrityErrors, ["issue metadata is missing"]);
      assert.strictEqual(provider.callsTo("addLabel").length, 0);
    });
  });

  it("sets integrity_error when metadata points to a different issue", async () => {
    await withStore(state(), async (tmpDir, provider) => {
      provider.seedIssue({ iid: 123, labels: ["To Do"], description: metadata(999) });

      await projectionIntegrityPass({
        workspaceDir: tmpDir,
        project: { slug: "devclaw" },
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
      });
      const loaded = await readIssueStateStore(tmpDir, "devclaw");

      assert.strictEqual(loaded.issues["123"]!.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
      assert.deepStrictEqual(loaded.issues["123"]!.integrityErrors, ["issue metadata does not match local issue state"]);
    });
  });

  it("archives a tombstone only after three confirmed missing checks over fifteen minutes", async () => {
    await withStore(state(), async (tmpDir, provider) => {
      const run = (now: string) => projectionIntegrityPass({
          workspaceDir: tmpDir,
          project: { slug: "devclaw" },
          provider,
          workflow: DEFAULT_WORKFLOW,
          roles: ["developer"],
          now: new Date(now),
        });

      const first = await run("2026-06-22T00:00:00.000Z");
      const second = await run("2026-06-22T00:08:00.000Z");
      const result = await run("2026-06-22T00:16:00.000Z");
      const loaded = await readIssueStateStore(tmpDir, "devclaw");
      const archive = await readIssueArchiveStore(tmpDir, "devclaw");

      assert.strictEqual(first.removed, 0);
      assert.strictEqual(second.removed, 0);
      assert.strictEqual(result.removed, 1);
      assert.strictEqual(result.errors, 0);
      assert.strictEqual(loaded.issues["123"], undefined);
      assert.strictEqual(Object.values(archive.issues)[0]?.archiveReason, "provider_deleted");
      assert.deepStrictEqual(result.events, [{ issueId: 123, action: "provider_missing" }]);
    });
  });
});
