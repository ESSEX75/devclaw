/** Tests that policy migration remains a shared application use case after repair extraction. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../../domain/index.js";
import { readIssueStateStore } from "../../../state/index.js";
import {
  createTestHarness,
  createEmptyIssueStateStoreForTesting as emptyIssueStateStore,
  replaceIssueStateStoreForTesting as writeIssueStateStore,
} from "../../../testing/index.js";
import { TestProvider } from "../../../testing/test-provider.js";
import { migrateIssuePolicies } from "./command.js";

/** Build a local issue ready for policy migration tests.
 * @param projectSlug - Canonical project identifier addressing local stores.
 */
function policyState(projectSlug: string): IssueRuntimeState {
  return {
    projectSlug,
    issueId: 75,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "toReview",
    workflowLabel: "To Review",
    assignedRole: null,
    assignedLevel: null,
    owner: null,
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    closedAt: null,
    providerMissing: null,
    pipelineNotification: null,
  };
}

describe("migrateIssuePolicies", () => {
  it("uses configured terminal states instead of built-in state names", async () => {
    const h = await createTestHarness();
    try {
      const directory = path.join(h.workspaceDir, "devclaw", "projects", h.project.slug);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "workflow.yaml"), "workflow:\n  states:\n    finished:\n      type: terminal\n      label: Finished\n      color: '#000000'\n");
      const store = emptyIssueStateStore(h.project.slug);
      store.issues["75"] = { ...policyState(h.project.slug), workflowState: "finished", workflowLabel: "Finished", closedAt: null };
      await writeIssueStateStore(h.workspaceDir, h.project.slug, store);
      const result = await migrateIssuePolicies({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, reviewPolicy: "agent", dryRun: true, runCommand: h.runCommand });
      assert.deepEqual(result.changed, []);
      assert.equal(result.skipped[0]?.reason, "closed");
    } finally { await h.cleanup(); }
  });
  it("keeps dry-run local and provider state unchanged", async () => {
    const h = await createTestHarness();
    try {
      const store = emptyIssueStateStore(h.project.slug);
      store.issues["75"] = policyState(h.project.slug);
      await writeIssueStateStore(h.workspaceDir, h.project.slug, store);
      h.provider.seedIssue({ iid: 75, labels: ["To Review", "review:human", "test:skip"] });

      const result = await migrateIssuePolicies({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        reviewPolicy: "agent",
        testPolicy: "agent",
        dryRun: true,
        provider: h.provider,
        runCommand: h.runCommand,
      });

      assert.equal(result.changed.length, 1);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["75"].reviewPolicy, "human");
      assert.equal(h.provider.callsTo("addLabel").length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("updates local policy truth before reconciling provider labels", async () => {
    const h = await createTestHarness();
    try {
      const store = emptyIssueStateStore(h.project.slug);
      store.issues["75"] = policyState(h.project.slug);
      await writeIssueStateStore(h.workspaceDir, h.project.slug, store);
      h.provider.seedIssue({ iid: 75, labels: ["To Review", "review:human", "test:skip"] });

      await migrateIssuePolicies({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        reviewPolicy: "agent",
        testPolicy: "agent",
        provider: h.provider,
        runCommand: h.runCommand,
      });
      const local = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["75"];
      const providerIssue = await h.provider.getIssue(75);

      assert.equal(local.reviewPolicy, "agent");
      assert.equal(local.testPolicy, "agent");
      assert.ok(providerIssue.labels.includes("review:agent"));
      assert.ok(providerIssue.labels.includes("test:agent"));
      assert.ok(!providerIssue.labels.includes("review:human"));
    } finally {
      await h.cleanup();
    }
  });

  it("retries projection after a partial provider failure without changing policy again", async () => {
    const h = await createTestHarness();
    try {
      const store = emptyIssueStateStore(h.project.slug);
      store.issues["75"] = policyState(h.project.slug);
      await writeIssueStateStore(h.workspaceDir, h.project.slug, store);
      /** Fails one provider label write to exercise policy reconciliation retry. */
      class FailingProvider extends TestProvider {
        failNextAdd = true;

        /** Exercise the fixture-specific provider label mutation or injected failure.
         * @param issueId - Provider-local issue identifier.
         * @param label - Provider label requested by the repair operation.
         */
        override async addLabel(issueId: number, label: string): Promise<void> {
          if (this.failNextAdd) {
            this.failNextAdd = false;
            throw new Error("provider write failed");
          }
          await super.addLabel(issueId, label);
        }
      }
      const provider = new FailingProvider();
      provider.seedIssue({ iid: 75, labels: ["To Review", "review:human", "test:skip"] });
      const options: Parameters<typeof migrateIssuePolicies>[0] = {
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        reviewPolicy: "agent", testPolicy: "agent",
        provider, runCommand: h.runCommand,
      };

      await assert.rejects(migrateIssuePolicies(options), /provider write failed/);
      const failed = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["75"];
      assert.equal(failed.reviewPolicy, "agent");
      assert.equal(failed.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);

      const recovered = await migrateIssuePolicies(options);
      const local = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["75"];
      const providerIssue = await provider.getIssue(75);
      assert.deepEqual(recovered.changed, []);
      assert.equal(recovered.skipped[0]?.reason, "no_change");
      assert.equal(local.integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
      assert.ok(providerIssue.labels.includes("review:agent"));
      assert.ok(providerIssue.labels.includes("test:agent"));
    } finally {
      await h.cleanup();
    }
  });

  it("skips policy changes while a worker is active", async () => {
    const h = await createTestHarness();
    try {
      const store = emptyIssueStateStore(h.project.slug);
      store.issues["75"] = policyState(h.project.slug);
      store.issues["75"].activeWorker = { role: "developer", level: "senior", slotIndex: 0, sessionKey: "s", startedAt: new Date().toISOString() };
      await writeIssueStateStore(h.workspaceDir, h.project.slug, store);
      const result = await migrateIssuePolicies({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        reviewPolicy: "agent", provider: h.provider, runCommand: h.runCommand,
      });

      assert.deepEqual(result.changed, []);
      assert.equal(result.skipped[0]?.reason, "active_worker");
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["75"].reviewPolicy, "human");
    } finally {
      await h.cleanup();
    }
  });
});
