/** Tests that policy migration remains a shared application use case after repair extraction. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore } from "../../state/issues/index.js";
import { createTestHarness } from "../../testing/index.js";
import { migrateIssuePolicies } from "./policy-migration.js";

function policyState(projectSlug: string): IssueRuntimeState {
  return {
    projectSlug,
    issueId: 75,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "toReview",
    workflowLabel: "To Review",
    reviewPolicy: "human",
    testPolicy: "skip",
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("migrateIssuePolicies", () => {
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
});
