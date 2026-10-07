/** Exercises interrupted completion effects and durable terminal recovery using real local stores. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";
import { DEFAULT_WORKFLOW, ISSUE_ARCHIVE_REASON, PIPELINE_NOTIFICATION_STATUS } from "../../domain/index.js";
import { readIssueStateStore, readProjects, reservePipelineNotification, updateProjects } from "../../state/index.js";
import { createTestHarness, type TestHarness } from "../../testing/index.js";
import { archiveManagedIssue } from "../issues/index.js";
import { retryPendingPipelineNotifications } from "../notifications/index.js";
import { executeCompletion } from "./completion.js";
import { recoverTransitionWorkers } from "./recovery.js";
import type { CompletionInput } from "./types.js";

/** Build one completion request without an externally routed notification transport.
 * @param h - Temporary project and provider fixture.
 * @param role - Completing built-in role.
 * @param result - Result selecting the workflow event.
 */
function input(h: TestHarness, role = "tester", result = "pass"): CompletionInput {
  return { workspaceDir: h.workspaceDir, projectSlug: h.project.slug, projectName: h.project.name,
    channels: h.project.channels, issueId: 42, role, result, provider: h.provider,
    repoPath: h.project.repo, runCommand: h.runCommand, workflow: DEFAULT_WORKFLOW };
}

describe("completion interruption recovery", () => {
  it("retains blocked terminal intent and does not repeat close on completion retry", async () => {
    const h = await createTestHarness({ workers: { tester: { active: true, issueId: 42, level: "medior" } } });

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Testing"] });
      await executeCompletion(input(h));
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];

      assert.equal(state.workflowState, "done");
      assert.equal(state.pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.BLOCKED);
      assert.equal(state.pendingWorkerRelease, null);
      await executeCompletion(input(h));
      assert.equal(h.provider.callsTo("closeIssue").length, 1);
      const archived = await archiveManagedIssue({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        issueId: 42, archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL, workflow: DEFAULT_WORKFLOW, actor: "test", correlationId: "test-42" });

      assert.equal(archived.reason, "notification_pending");
    } finally { await h.cleanup(); }
  });

  it("retries a failed close after the label changed without losing the source state", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Testing"] });
      const close = t.mock.method(h.provider, "closeIssue", async () => { throw new Error("close unavailable"); });

      await assert.rejects(executeCompletion(input(h)), /close unavailable/);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "Testing");
      assert.ok((await h.provider.getIssue(42)).labels.includes("Done"));
      close.mock.restore();
      await executeCompletion(input(h));
      assert.equal((await h.provider.getIssue(42)).state, "closed");
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "Done");
    } finally { await h.cleanup(); }
  });

  it("retries a failed reopen and clears the persisted close time", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Testing"], state: "closed" });
      const reopen = t.mock.method(h.provider, "reopenIssue", async () => { throw new Error("reopen unavailable"); });

      await assert.rejects(executeCompletion(input(h, "tester", "fail")), /reopen unavailable/);
      reopen.mock.restore();
      await executeCompletion(input(h, "tester", "fail"));
      assert.equal((await h.provider.getIssue(42)).state, "opened");
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].closedAt, null);
    } finally { await h.cleanup(); }
  });

  it("does not repeat a successful merge when the following provider transition fails", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Reviewing"] });
      h.provider.setPrStatus(42, { state: "open", url: "https://example.com/pr/42" });
      const transition = t.mock.method(h.provider, "addLabels", async () => { throw new Error("transition unavailable"); });

      await assert.rejects(executeCompletion(input(h, "reviewer", "approve")), /transition unavailable/);
      transition.mock.restore();
      await executeCompletion(input(h, "reviewer", "approve"));
      assert.equal(h.provider.callsTo("mergePr").length, 1);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "To Test");
    } finally { await h.cleanup(); }
  });

  it("uses merged read-back after a lost merge response", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Reviewing"] });
      h.provider.setPrStatus(42, { state: "open", url: "https://example.com/pr/42" });
      const merge = h.provider.mergePr.bind(h.provider);

      t.mock.method(h.provider, "mergePr", async (issueId: number) => { await merge(issueId); throw new Error("response lost"); });
      await executeCompletion(input(h, "reviewer", "approve"));
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "To Test");
      assert.equal(h.provider.callsTo("mergePr").length, 1);
    } finally { await h.cleanup(); }
  });

  it("recovers a successful merge after the local state commit fails", async (t) => {
    const h = await createTestHarness();
    let failWrites = false;
    const rename = fs.rename.bind(fs);
    const fault = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      if (failWrites) throw new Error("state disk unavailable");

      return rename(...args);
    });

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Reviewing"] });
      h.provider.setPrStatus(42, { state: "open", url: "https://example.com/pr/42" });
      const transition = h.provider.addLabels.bind(h.provider);

      t.mock.method(h.provider, "addLabels", async (...args: Parameters<typeof transition>) => {
        await transition(...args);
        failWrites = true;
      });
      await assert.rejects(executeCompletion(input(h, "reviewer", "approve")), /state disk unavailable/);
      failWrites = false;
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "Reviewing");
      await executeCompletion(input(h, "reviewer", "approve"));
      assert.equal(h.provider.callsTo("mergePr").length, 1);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "To Test");
    } finally { fault.mock.restore(); await h.cleanup(); }
  });

  it("retains the source when merged read-back is unavailable and resumes from later evidence", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Reviewing"] });
      h.provider.setPrStatus(42, { state: "open", url: "https://example.com/pr/42" });
      const merge = h.provider.mergePr.bind(h.provider);
      const read = h.provider.getPrStatus.bind(h.provider);
      let merged = false;

      t.mock.method(h.provider, "mergePr", async (issueId: number) => {
        await merge(issueId);
        merged = true;
        throw new Error("response lost");
      });
      const fault = t.mock.method(h.provider, "getPrStatus", async (issueId: number) => {
        if (merged) throw new Error("read unavailable");

        return read(issueId);
      });

      await assert.rejects(executeCompletion(input(h, "reviewer", "approve")), /read unavailable/);
      fault.mock.restore();
      await executeCompletion(input(h, "reviewer", "approve"));
      assert.equal(h.provider.callsTo("mergePr").length, 1);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "To Test");
    } finally { await h.cleanup(); }
  });

  it("keeps unknown merge outcome in the source state instead of claiming merge failure", async (t) => {
    const h = await createTestHarness();

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Reviewing"] });
      h.provider.setPrStatus(42, { state: "open", url: "https://example.com/pr/42" });
      t.mock.method(h.provider, "mergePr", async () => { throw new Error("response lost"); });
      await assert.rejects(executeCompletion(input(h, "reviewer", "approve")), /response lost/);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].workflowLabel, "Reviewing");
    } finally { await h.cleanup(); }
  });

  it("commits terminal intent before release, fences a replacement slot, and recovers the original slot", async (t) => {
    const h = await createTestHarness({ workers: { tester: { active: true, issueId: 42, level: "medior" } } });

    try {
      h.provider.seedIssue({ iid: 42, labels: ["Testing"] });
      const original = (await readProjects(h.workspaceDir)).projects[h.project.slug].workers.tester.levels.medior?.[0];

      assert.ok(original);
      const close = h.provider.closeIssue.bind(h.provider);

      t.mock.method(h.provider, "closeIssue", async (issueId: number) => {
        await close(issueId);
        await updateProjects(h.workspaceDir, (data) => {
          const slots = data.projects[h.project.slug].workers.tester.levels.medior;

          assert.ok(slots);
          slots[0] = { ...original, sessionKey: "replacement-session" };

          return { data, result: undefined };
        });
      });
      await assert.rejects(executeCompletion(input(h)), /replacement worker/);
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];

      assert.equal(state.workflowState, "done");
      assert.equal(state.pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.PENDING);
      assert.equal(state.pendingWorkerRelease?.sessionKey, original.sessionKey);
      assert.equal(await retryPendingPipelineNotifications(h.workspaceDir, h.project, h.provider, undefined, undefined, h.runCommand, 10), 0);
      await assert.rejects(recoverTransitionWorkers(h.workspaceDir, h.project.slug, 10), /replacement worker/);
      await updateProjects(h.workspaceDir, (data) => {
        const slots = data.projects[h.project.slug].workers.tester.levels.medior;

        assert.ok(slots);
        slots[0] = original;

        return { data, result: undefined };
      });
      await recoverTransitionWorkers(h.workspaceDir, h.project.slug, 10);
      await recoverTransitionWorkers(h.workspaceDir, h.project.slug, 10);
      assert.equal((await readProjects(h.workspaceDir)).projects[h.project.slug].workers.tester.levels.medior?.[0].active, false);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].pendingWorkerRelease, null);
      assert.ok(await reservePipelineNotification(h.workspaceDir, h.project.slug, 42, "pipelineComplete:done"));
    } finally { await h.cleanup(); }
  });
});
