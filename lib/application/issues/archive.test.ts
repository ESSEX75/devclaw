/** Tests lossless issue archival, retention, and confirmed provider deletion. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
  DEFAULT_WORKFLOW,
} from "../../domain/index.js";
import {
  emptyIssueStateStore,
  readIssueArchiveStore,
  readIssueStateStore,
  writeIssueArchiveStore,
  writeIssueStateStore,
} from "../../state/issues/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import {
  archiveManagedIssue,
  getIssueArchiveStatus,
  purgeIssueArchive,
  recoverTerminalIssueArchives,
} from "./archive.js";
import { deleteManagedIssue } from "./delete.js";

function issue(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw", issueId: 42, provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "done", workflowLabel: "Done", activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK, integrityErrors: [], projectionVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

async function withIssueStore<T>(run: (workspaceDir: string) => Promise<T>): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-archive-"));
  const store = emptyIssueStateStore("devclaw");
  store.issues["42"] = issue();
  await writeIssueStateStore(workspaceDir, "devclaw", store);
  try { return await run(workspaceDir); } finally { await fs.rm(workspaceDir, { recursive: true, force: true }); }
}

describe("managed issue archive", () => {
  it("moves state archive-first into the dedicated archive and remains idempotent", async () => {
    await withIssueStore(async (workspaceDir) => {
      const options = {
        workspaceDir, projectSlug: "devclaw", issueId: 42,
        archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
        actor: "test", correlationId: "archive-test",
      };
      const first = await archiveManagedIssue(options);
      const second = await archiveManagedIssue(options);
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      const archive = await readIssueArchiveStore(workspaceDir, "devclaw");

      assert.equal(first.archived, true);
      assert.equal(second.reason, "already_archived");
      assert.equal(active.issues["42"], undefined);
      assert.equal(Object.keys(archive.issues).length, 1);
    });
  });

  it("blocks archival while a worker is active", async () => {
    await withIssueStore(async (workspaceDir) => {
      const store = await readIssueStateStore(workspaceDir, "devclaw");
      store.issues["42"].activeWorker = { role: "developer", level: "senior", slotIndex: 0, sessionKey: "s", startedAt: new Date().toISOString() };
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const result = await archiveManagedIssue({
        workspaceDir, projectSlug: "devclaw", issueId: 42,
        archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "active-test",
      });
      assert.equal(result.reason, "active_worker");
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
    });
  });

  it("recovers an active duplicate without duplicating the archive record", async () => {
    await withIssueStore(async (workspaceDir) => {
      const options = { workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "crash-test" };
      await archiveManagedIssue(options);
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"] = issue();
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      await archiveManagedIssue(options);
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"], undefined);
    });
  });

  it("keeps failed issues active while a retry remains", async () => {
    await withIssueStore(async (workspaceDir) => {
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"] = issue({ workflowState: "failed", workflowLabel: "Failed", retriesRemaining: 1 });
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      const result = await recoverTerminalIssueArchives({
        workspaceDir, projectSlug: "devclaw", workflow: {
          ...DEFAULT_WORKFLOW,
          states: { ...DEFAULT_WORKFLOW.states, failed: { type: "terminal", label: "Failed", color: "#000000" } },
        }, maxItems: 10,
      });
      assert.deepEqual(result.skipped, [{ issueId: 42, reason: "retry_pending" }]);
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
    });
  });

  it("keeps purge dry-run read-only", async () => {
    await withIssueStore(async (workspaceDir) => {
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "purge-test" });
      const result = await purgeIssueArchive({
        workspaceDir,
        projectSlug: "devclaw",
        archiveRetention: "0d",
        deletedProviderRetention: "0d",
        maxItems: 10,
        apply: false,
        actor: "test",
        correlationId: "purge-test",
      });
      assert.deepEqual(result.purge, [42]);
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
    });
  });

  it("uses the shorter provider-deleted retention in status and purge", async () => {
    await withIssueStore(async (workspaceDir) => {
      await archiveManagedIssue({
        workspaceDir,
        projectSlug: "devclaw",
        issueId: 42,
        archiveReason: ISSUE_ARCHIVE_REASON.PROVIDER_DELETED,
        providerDeletedAt: "2026-01-01T00:00:00.000Z",
        actor: "test",
        correlationId: "provider-retention-test",
      });
      const archive = await readIssueArchiveStore(workspaceDir, "devclaw");
      const record = Object.values(archive.issues)[0];

      assert.ok(record);
      record.archivedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
      await writeIssueArchiveStore(workspaceDir, "devclaw", archive);

      const status = await getIssueArchiveStatus({
        workspaceDir,
        projectSlug: "devclaw",
        archiveRetention: "30d",
        deletedProviderRetention: "1d",
      });
      const preview = await purgeIssueArchive({
        workspaceDir,
        projectSlug: "devclaw",
        archiveRetention: "30d",
        deletedProviderRetention: "1d",
        maxItems: 10,
        apply: false,
        actor: "test",
        correlationId: "provider-retention-test",
      });

      assert.equal(status.purgeEligible, 1);
      assert.deepEqual(preview.purge, [42]);
    });
  });

  it("requires exact confirmation before deleting and archives a tombstone", async () => {
    await withIssueStore(async (workspaceDir) => {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 42, title: "Delete me", web_url: "https://example.test/42" });
      const preview = await deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, provider, actor: "test" });
      assert.equal(preview.dryRun, true);
      assert.equal(provider.callsTo("deleteIssue").length, 0);
      await assert.rejects(deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 41, dryRun: false, provider, actor: "test" }), /confirmIssueId/);
      const result = await deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" });
      const archive = await readIssueArchiveStore(workspaceDir, "devclaw");
      assert.equal(result.deleted, true);
      assert.equal(Object.values(archive.issues)[0]?.archiveReason, ISSUE_ARCHIVE_REASON.PROVIDER_DELETED);
    });
  });
});
