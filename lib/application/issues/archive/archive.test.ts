/** Tests lossless issue archival, retention, and confirmed provider deletion. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  PIPELINE_NOTIFICATION_STATUS,
  type IssueRuntimeState,
} from "../../../domain/index.js";
import { PROVIDER_ISSUE_LOOKUP_ERROR } from "../../../integrations/providers/errors/index.js";
import { ProviderIssueLookupError } from "../../../integrations/providers/errors/index.js";
import {
  listAttachments,
  readIssueArchiveStore,
  readIssueStateStore,
  saveAttachment,
  updateIssueArchiveStore,
  withIssueOrchestrationLock,
} from "../../../state/index.js";
import {
  createTestHarness,
  createEmptyIssueStateStoreForTesting as emptyIssueStateStore,
  replaceIssueArchiveStoreForTesting as writeIssueArchiveStore,
  replaceIssueStateStoreForTesting as writeIssueStateStore,
} from "../../../testing/index.js";
import { TestProvider } from "../../../testing/test-provider.js";
import { deleteManagedIssue } from "../deletion/command.js";
import {
  archiveManagedIssue,
  getIssueArchiveStatus,
  maintainIssueArchive,
  purgeIssueArchive,
  recoverTerminalIssueArchives,
} from "./index.js";

/** Create a complete terminal runtime fixture with selected overrides.
 * @param overrides - Fixture values required for this failure or recovery scenario.
 */
function issue(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw", issueId: 42, provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "done", workflowLabel: "Done", assignedRole: null, assignedLevel: null,
    owner: null, reviewPolicy: null, testPolicy: null, notifyTarget: null, activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK, integrityErrors: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:00.000Z", providerMissing: null, pipelineNotification: null,
    ...overrides,
  };
}

/** Run an archival scenario in isolated storage and always remove its temporary workspace.
 * @param run - Test scenario executed against the isolated workspace.
 */
async function withIssueStore<T>(run: (workspaceDir: string) => Promise<T>): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-archive-"));
  const store = emptyIssueStateStore("devclaw");
  store.issues["42"] = issue();
  await writeIssueStateStore(workspaceDir, "devclaw", store);
  try { return await run(workspaceDir); } finally { await fs.rm(workspaceDir, { recursive: true, force: true }); }
}

describe("managed issue archive", () => {
  it("rechecks terminal eligibility after waiting for a concurrent lifecycle transition", async t => {
    await withIssueStore(async workspaceDir => {
      let entered!: () => void;
      let release!: () => void;
      const acquired = new Promise<void>(resolve => { entered = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      const transition = withIssueOrchestrationLock(workspaceDir, "devclaw", 42, async () => {
        entered();
        await resume;
        const store = await readIssueStateStore(workspaceDir, "devclaw");
        store.issues["42"] = issue({ workflowState: "todo", workflowLabel: "To Do", closedAt: null });
        await writeIssueStateStore(workspaceDir, "devclaw", store);
      });
      await acquired;
      let selected!: () => void;
      const snapshotRead = new Promise<void>(resolve => { selected = resolve; });
      const read = fs.readFile;
      const capture = t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
        const value = await read(...args);
        if (String(args[0]).endsWith("issues.json")) selected();
        return value;
      });
      const recovery = recoverTerminalIssueArchives({ workspaceDir, projectSlug: "devclaw", workflow: DEFAULT_WORKFLOW, maxItems: 1 });
      await snapshotRead;
      release();
      await transition;
      assert.deepEqual((await recovery).archived, []);
      capture.mock.restore();
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
    });
  });

  it("preserves a changed active duplicate instead of reusing an older archived snapshot", async () => {
    await withIssueStore(async workspaceDir => {
      const opts = { workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "duplicate" };
      await archiveManagedIssue(opts);
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"] = issue({ owner: "new-owner" });
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      await assert.rejects(archiveManagedIssue(opts), /different archived snapshot/);
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"].owner, "new-owner");
    });
  });

  it("keeps the archive recovery record when file cleanup succeeds but the record commit fails", async t => {
    await withIssueStore(async workspaceDir => {
      await saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("proof"), filename: "proof.txt", mimeType: "text/plain", uploader: "test" });
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "commit" });
      const rename = fs.rename;
      const injected = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]).endsWith("issues.archive.json")) throw new Error("retention commit unavailable");
        return rename(...args);
      });
      const options = { workspaceDir, projectSlug: "devclaw", archiveRetention: "0d", deletedProviderRetention: "0d", attachmentsRetention: "0d", maxItems: 1 };
      await assert.rejects(maintainIssueArchive(options), /retention commit unavailable/);
      injected.mock.restore();
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
      assert.deepEqual(await listAttachments(workspaceDir, "devclaw", 42), []);
      assert.deepEqual((await maintainIssueArchive(options)).recordsPurged, [42]);
    });
  });

  it("blocks archive and deletion for an occupied project slot even if the issue worker marker is absent", async () => {
    const h = await createTestHarness({ workers: { developer: { active: true, issueId: 42, sessionKey: "owned" } } });
    try {
      const active = emptyIssueStateStore(h.project.slug);
      active.issues["42"] = issue({ projectSlug: h.project.slug });
      await writeIssueStateStore(h.workspaceDir, h.project.slug, active);
      const archived = await archiveManagedIssue({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "slot" });
      assert.equal(archived.reason, "worker_slot");
      await assert.rejects(deleteManagedIssue({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 42, confirmIssueId: 42, dryRun: false, provider: h.provider, actor: "test" }), /worker slot/);
      assert.equal(h.provider.callsTo("deleteIssue").length, 0);
    } finally { await h.cleanup(); }
  });

  it("processes attachment expiry first and later removes the record without losing cleanup evidence", async () => {
    await withIssueStore(async workspaceDir => {
      await saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("proof"), filename: "proof.txt", mimeType: "text/plain", uploader: "test" });
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.PROVIDER_DELETED, actor: "test", correlationId: "windows" });
      const opts = { workspaceDir, projectSlug: "devclaw", archiveRetention: "30d", deletedProviderRetention: "30d", attachmentsRetention: "0d", maxItems: 1 };
      assert.deepEqual(await maintainIssueArchive(opts), { attachmentsPurged: [42], recordsPurged: [] });
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
      await assert.rejects(saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("late"), filename: "late.txt", mimeType: "text/plain", uploader: "test" }), /archived/);
      assert.deepEqual((await maintainIssueArchive({ ...opts, deletedProviderRetention: "0d" })).recordsPurged, [42]);
    });
  });
  it("keeps archive and bytes when the required purge journal cannot be written, then retries", async t => {
    await withIssueStore(async workspaceDir => {
      await saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("proof"), filename: "proof.txt", mimeType: "text/plain", uploader: "test" });
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "journal" });
      const append = fs.appendFile;
      const injected = t.mock.method(fs, "appendFile", async (...args: Parameters<typeof fs.appendFile>) => {
        if (String(args[0]).endsWith("archive-retention.audit.jsonl")) throw new Error("journal unavailable");
        return append(...args);
      });
      const options = { workspaceDir, projectSlug: "devclaw", archiveRetention: "0d", deletedProviderRetention: "0d", attachmentsRetention: "30d", maxItems: 1 };
      await assert.rejects(maintainIssueArchive(options), /journal unavailable/);
      injected.mock.restore();
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
      assert.equal((await listAttachments(workspaceDir, "devclaw", 42)).length, 1);
      assert.deepEqual((await maintainIssueArchive(options)).recordsPurged, [42]);
      const journal = await fs.readFile(path.join(workspaceDir, "devclaw", "projects", "devclaw", "archive-retention.audit.jsonl"), "utf8");
      assert.match(journal, /proof\.txt/);
      assert.match(journal, /sha256/);
    });
  });

  it("recovers after provider deletion succeeds and archive replacement fails", async t => {
    await withIssueStore(async workspaceDir => {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 42 });
      const rename = fs.rename;
      const failure = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]).endsWith("issues.archive.json")) throw new Error("archive unavailable");
        return rename(...args);
      });
      const options = { workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" };
      const first = await deleteManagedIssue(options);
      assert.equal(first.deleted, true);
      assert.equal(first.archived, false);
      assert.ok(first.recoveryPlan?.length);
      failure.mock.restore();
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
      assert.equal((await deleteManagedIssue(options)).archived, true);
      assert.equal(provider.callsTo("deleteIssue").length, 1);
    });
  });

  it("does not interpret authorization or transient lookup failures as confirmed deletion", async t => {
    await withIssueStore(async workspaceDir => {
      for (const code of [PROVIDER_ISSUE_LOOKUP_ERROR.FORBIDDEN, PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT]) {
        const provider = new TestProvider();
        const error = new ProviderIssueLookupError({ code, provider: "github", message: "lookup failed", retryable: true });
        t.mock.method(provider, "getIssue", async () => { throw error; });
        await assert.rejects(deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" }), value => value === error);
        assert.equal(provider.callsTo("deleteIssue").length, 0);
        assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
      }
    });
  });

  it("honors a zero retention budget and rejects negative budgets before effects", async () => {
    await withIssueStore(async workspaceDir => {
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "budget" });
      const options = { workspaceDir, projectSlug: "devclaw", archiveRetention: "0d", deletedProviderRetention: "0d", attachmentsRetention: "0d", maxItems: 0 };
      assert.deepEqual(await maintainIssueArchive(options), { attachmentsPurged: [], recordsPurged: [] });
      await assert.rejects(maintainIssueArchive({ ...options, maxItems: -1 }), /maxItems/);
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 1);
    });
  });

  it("refuses direct terminal archival for a live queue state", async () => {
    await withIssueStore(async workspaceDir => {
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"] = issue({ workflowState: "todo", workflowLabel: "To Do", closedAt: null });
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      const result = await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "eligibility" });
      assert.equal(result.reason, "not_terminal");
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
    });
  });
  it("cleans attachments before removing an expired record even when attachment retention is longer", async () => {
    await withIssueStore(async workspaceDir => {
      await saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("retain me"), filename: "proof.txt", mimeType: "text/plain", uploader: "test" });
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "retention" });
      const result = await maintainIssueArchive({ workspaceDir, projectSlug: "devclaw", archiveRetention: "0d", deletedProviderRetention: "0d", attachmentsRetention: "30d", maxItems: 1 });
      assert.deepEqual(result.recordsPurged, [42]);
      assert.deepEqual(await listAttachments(workspaceDir, "devclaw", 42), []);
    });
  });

  it("refuses provider deletion before an unconfirmed terminal notification is resolved", async () => {
    await withIssueStore(async workspaceDir => {
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"].pipelineNotification = { eventKey: "pipelineComplete:done", status: PIPELINE_NOTIFICATION_STATUS.ATTEMPTING, attemptedAt: new Date().toISOString() };
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      const provider = new TestProvider();
      provider.seedIssue({ iid: 42 });
      await assert.rejects(deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" }), /notification/i);
      assert.equal(provider.callsTo("deleteIssue").length, 0);
    });
  });

  it("does not purge or overwrite a record changed after retention selection", async t => {
    await withIssueStore(async workspaceDir => {
      await saveAttachment(workspaceDir, "devclaw", 42, { buffer: Buffer.from("proof"), filename: "proof.txt", mimeType: "text/plain", uploader: "test" });
      await archiveManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, actor: "test", correlationId: "race" });
      let entered!: () => void;
      let release!: () => void;
      const captured = new Promise<void>(resolve => { entered = resolve; });
      const resumed = new Promise<void>(resolve => { release = resolve; });
      const read = fs.readFile;
      let pause = true;
      const injected = t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
        const result = await read(...args);
        if (pause && String(args[0]).endsWith("issues.archive.json")) {
          pause = false;
          entered();
          await resumed;
        }
        return result;
      });
      const pending = maintainIssueArchive({ workspaceDir, projectSlug: "devclaw", archiveRetention: "0d", deletedProviderRetention: "0d", attachmentsRetention: "0d", maxItems: 1 });
      await captured;
      await updateIssueArchiveStore(workspaceDir, "devclaw", store => ({ store: { ...store, issues: Object.fromEntries(Object.entries(store.issues).map(([key, record]) => [key, { ...record, archivedAt: "2099-01-01T00:00:00.000Z", title: "concurrent" }])) }, result: undefined }));
      release();
      await pending;
      injected.mock.restore();
      assert.equal(Object.values((await readIssueArchiveStore(workspaceDir, "devclaw")).issues)[0]?.title, "concurrent");
      assert.equal((await listAttachments(workspaceDir, "devclaw", 42)).length, 1);
    });
  });

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

  for (const notificationStatus of [PIPELINE_NOTIFICATION_STATUS.ATTEMPTING, PIPELINE_NOTIFICATION_STATUS.BLOCKED, PIPELINE_NOTIFICATION_STATUS.RETRYABLE, PIPELINE_NOTIFICATION_STATUS.UNKNOWN]) {
  it(`keeps terminal state active while its notification is ${notificationStatus}`, async () => {
    await withIssueStore(async (workspaceDir) => {
      const store = await readIssueStateStore(workspaceDir, "devclaw");

      store.issues["42"].pipelineNotification = {
        eventKey: "pipelineComplete:done",
        status: notificationStatus,
        attemptedAt: "2026-01-01T00:00:00.000Z",
      };
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const result = await archiveManagedIssue({
        workspaceDir,
        projectSlug: "devclaw",
        issueId: 42,
        archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
        actor: "test",
        correlationId: "pending-notification-test",
      });

      assert.equal(result.reason, "notification_pending");
      assert.ok((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"]);
      assert.equal(Object.keys((await readIssueArchiveStore(workspaceDir, "devclaw")).issues).length, 0);
    });
  });

  }

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

  it("archives failed terminal issues without an unimplemented retry state", async () => {
    await withIssueStore(async (workspaceDir) => {
      const active = await readIssueStateStore(workspaceDir, "devclaw");
      active.issues["42"] = issue({ workflowState: "failed", workflowLabel: "Failed" });
      await writeIssueStateStore(workspaceDir, "devclaw", active);
      const result = await recoverTerminalIssueArchives({
        workspaceDir, projectSlug: "devclaw", workflow: {
          ...DEFAULT_WORKFLOW,
          states: { ...DEFAULT_WORKFLOW.states, failed: { type: "terminal", label: "Failed", color: "#000000" } },
        }, maxItems: 10,
      });
      assert.deepEqual(result.archived, [42]);
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"], undefined);
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
      const retried = await deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" });
      assert.equal(retried.archived, true);
      assert.equal(provider.callsTo("deleteIssue").length, 1);
    });
  });

  it("recovers when provider deletion succeeded but local archival did not", async () => {
    await withIssueStore(async (workspaceDir) => {
      const provider = new TestProvider();
      const result = await deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" });

      assert.equal(result.archived, true);
      assert.equal(provider.callsTo("deleteIssue").length, 0);
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["42"], undefined);
      assert.equal(Object.values((await readIssueArchiveStore(workspaceDir, "devclaw")).issues)[0]?.archiveReason, ISSUE_ARCHIVE_REASON.PROVIDER_DELETED);
    });
  });

  it("blocks deletion while a worker is active", async () => {
    await withIssueStore(async (workspaceDir) => {
      const store = await readIssueStateStore(workspaceDir, "devclaw");
      store.issues["42"].activeWorker = { role: "developer", level: "senior", slotIndex: 0, sessionKey: "s", startedAt: new Date().toISOString() };
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const provider = new TestProvider();
      provider.seedIssue({ iid: 42 });

      await assert.rejects(deleteManagedIssue({ workspaceDir, projectSlug: "devclaw", issueId: 42, confirmIssueId: 42, dryRun: false, provider, actor: "test" }), /active worker/);
      assert.equal(provider.callsTo("deleteIssue").length, 0);
    });
  });
});
