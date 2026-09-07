/** Tests managed-issue repair planning, stale-plan protection, strict provider import, and verification. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  type IssueRuntimeState,
} from "../../domain/index.js";
import { renderIssueMetadata } from "../../projection/index.js";
import { emptyIssueStateStore, readIssueStateStore, writeIssueStateStore } from "../../state/issues/index.js";
import { createTestHarness } from "../../testing/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import {
  ISSUE_REPAIR_ERROR,
  ISSUE_REPAIR_SOURCE,
  isIssueRepairFailure,
  repairManagedIssue,
} from "./repair.js";

function state(projectSlug: string, overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug,
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    owner: "main",
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: { channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" },
    branchContract: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
    integrityErrors: ["projection drift"],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

async function seedState(workspaceDir: string, issue: IssueRuntimeState): Promise<void> {
  const store = emptyIssueStateStore(issue.projectSlug);
  store.issues[String(issue.issueId)] = issue;
  await writeIssueStateStore(workspaceDir, issue.projectSlug, store);
}

describe("repairManagedIssue", () => {
  it("plans local-state projection repair without mutation", async () => {
    const h = await createTestHarness();
    try {
      await seedState(h.workspaceDir, state(h.project.slug));
      h.provider.seedIssue({ iid: 123, labels: ["Doing", "bug"], description: "Body" });
      const result = await repairManagedIssue({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      });

      assert.equal(result.mode, "dry_run");
      assert.equal(result.status, "planned");
      assert.ok(result.diffBefore.missingManagedLabels.includes("To Do"));
      assert.ok(result.diffBefore.unmanagedLabels.includes("bug"));
      assert.equal(h.provider.callsTo("addLabel").length, 0);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["123"].integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    } finally {
      await h.cleanup();
    }
  });

  it("applies a current plan, preserves unmanaged labels, and verifies integrity", async () => {
    const h = await createTestHarness();
    try {
      await seedState(h.workspaceDir, state(h.project.slug));
      h.provider.seedIssue({ iid: 123, labels: ["Doing", "bug"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });
      const providerIssue = await h.provider.getIssue(123);
      const local = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["123"];

      assert.equal(result.status, "repaired");
      assert.equal(result.diffAfter?.missingManagedLabels.length, 0);
      assert.ok(providerIssue.labels.includes("bug"));
      assert.ok(providerIssue.labels.includes("To Do"));
      assert.equal(local.integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
    } finally {
      await h.cleanup();
    }
  });

  it("rejects an apply whose provider snapshot changed after dry-run", async () => {
    const h = await createTestHarness();
    try {
      await seedState(h.workspaceDir, state(h.project.slug));
      h.provider.seedIssue({ iid: 123, labels: ["Doing"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      h.provider.seedIssue({ iid: 123, labels: ["Doing", "changed-after-plan"], description: "Body" });
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });

      assert.equal(result.error?.code, ISSUE_REPAIR_ERROR.PLAN_STALE);
      assert.equal(h.provider.callsTo("addLabel").length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("imports only allowed provider fields and preserves branch state", async () => {
    const h = await createTestHarness();
    try {
      const local = state(h.project.slug, { branchContract: { branch: "feature/123" } });
      await seedState(h.workspaceDir, local);
      h.provider.seedIssue({
        iid: 123,
        labels: ["Doing", "developer:senior", "owner:alice", "review:agent", "test:agent", "notify:telegram:primary", "bug"],
        description: renderIssueMetadata({ projectSlug: h.project.slug, issueId: 123, projectionVersion: 1 }),
      });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.PROVIDER,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });
      const repaired = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["123"];

      assert.equal(result.status, "repaired");
      assert.equal(repaired.workflowState, "doing");
      assert.equal(repaired.assignedLevel, "senior");
      assert.equal(repaired.owner, "alice");
      assert.deepEqual(repaired.branchContract, { branch: "feature/123" });
      assert.equal(repaired.activeWorker, null);
    } finally {
      await h.cleanup();
    }
  });

  it("rejects ambiguous provider workflow labels without local mutation", async () => {
    const h = await createTestHarness();
    try {
      await seedState(h.workspaceDir, state(h.project.slug));
      h.provider.seedIssue({
        iid: 123,
        labels: ["To Do", "Doing"],
        description: renderIssueMetadata({ projectSlug: h.project.slug, issueId: 123, projectionVersion: 1 }),
      });

      await assert.rejects(
        repairManagedIssue({
          workspaceDir: h.workspaceDir,
          projectSlug: h.project.slug,
          issueId: 123,
          source: ISSUE_REPAIR_SOURCE.PROVIDER,
          actor: "test",
          provider: h.provider,
          runCommand: h.runCommand,
        }),
        (error) => isIssueRepairFailure(error) && error.code === ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS,
      );
    } finally {
      await h.cleanup();
    }
  });

  it("blocks active workers and insufficient known quota before mutation", async () => {
    class LimitedProvider extends TestProvider {
      async getRateLimitStatus() { return { remaining: 0, resetAt: "2026-09-06T00:00:00.000Z" }; }
    }

    const h = await createTestHarness();
    try {
      const provider = new LimitedProvider();
      await seedState(h.workspaceDir, state(h.project.slug));
      provider.seedIssue({ iid: 123, labels: ["Doing"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const quotaBlocked = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });

      assert.equal(quotaBlocked.error?.code, ISSUE_REPAIR_ERROR.RATE_LIMIT_PRECHECK_FAILED);
      assert.equal(quotaBlocked.error?.retryAfter, "2026-09-06T00:00:00.000Z");
      assert.equal(provider.callsTo("addLabel").length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("returns a verified no-op and clears a stale integrity error", async () => {
    const h = await createTestHarness();
    try {
      const local = state(h.project.slug);
      await seedState(h.workspaceDir, local);
      h.provider.seedIssue({
        iid: 123,
        labels: ["To Do", "developer:medior", "owner:main", "review:human", "test:skip", "notify:telegram:primary"],
        description: renderIssueMetadata({ projectSlug: h.project.slug, issueId: 123, projectionVersion: 1 }),
      });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });

      assert.equal(result.status, "already_consistent");
      assert.equal(result.changed, false);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["123"].integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps integrity unhealthy when provider verification still finds drift", async () => {
    class NonMutatingProvider extends TestProvider {
      async addLabel(): Promise<void> {}
      async removeLabels(): Promise<void> {}
    }

    const h = await createTestHarness();
    try {
      const provider = new NonMutatingProvider();
      await seedState(h.workspaceDir, state(h.project.slug));
      provider.seedIssue({ iid: 123, labels: ["Doing"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });

      assert.equal(result.error?.code, ISSUE_REPAIR_ERROR.REPAIR_VERIFICATION_FAILED);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["123"].integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    } finally {
      await h.cleanup();
    }
  });

  it("blocks apply while an active worker owns the issue", async () => {
    const h = await createTestHarness();
    try {
      await seedState(h.workspaceDir, state(h.project.slug, {
        activeWorker: { role: "developer", level: "medior", slotIndex: 0, sessionKey: "session", startedAt: "2026-09-05T00:00:00.000Z" },
      }));
      h.provider.seedIssue({ iid: 123, labels: ["Doing"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider: h.provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const result = await repairManagedIssue({ ...input, apply: true, planToken: plan.planToken });

      assert.equal(result.error?.code, ISSUE_REPAIR_ERROR.ACTIVE_WORKER);
      assert.equal(h.provider.callsTo("addLabel").length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("serializes concurrent apply attempts and rejects the stale follower", async () => {
    class SlowProvider extends TestProvider {
      override async addLabel(issueId: number, label: string): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await super.addLabel(issueId, label);
      }
    }

    const h = await createTestHarness();
    try {
      const provider = new SlowProvider();
      await seedState(h.workspaceDir, state(h.project.slug));
      provider.seedIssue({ iid: 123, labels: ["Doing"], description: "Body" });
      const input = {
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        issueId: 123,
        source: ISSUE_REPAIR_SOURCE.LOCAL_STATE,
        actor: "test",
        provider,
        runCommand: h.runCommand,
      };
      const plan = await repairManagedIssue(input);
      const results = await Promise.all([
        repairManagedIssue({ ...input, apply: true, planToken: plan.planToken }),
        repairManagedIssue({ ...input, apply: true, planToken: plan.planToken }),
      ]);

      assert.equal(results.filter((result) => result.status === "repaired").length, 1);
      assert.equal(results.filter((result) => result.error?.code === ISSUE_REPAIR_ERROR.PLAN_STALE).length, 1);
    } finally {
      await h.cleanup();
    }
  });
});
