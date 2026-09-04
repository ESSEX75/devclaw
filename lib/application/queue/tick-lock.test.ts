import assert from "node:assert";
import { describe, it } from "node:test";

import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
} from "../../domain/index.js";
import {
  emptyIssueStateStore,
  withIssueOrchestrationLock,
  writeIssueStateStore,
} from "../../state/issues/index.js";
import { createTestHarness } from "../../testing/index.js";
import { projectTick } from "./tick.js";

describe("projectTick issue orchestration lock", () => {
  it("selects a managed level from local role state instead of provider labels", async () => {
    const harness = await createTestHarness();
    const issueId = 80;
    const store = emptyIssueStateStore(harness.project.slug);

    store.issues[String(issueId)] = issueState(harness.project.slug, issueId, {
      assignedRole: "tester",
      assignedLevel: "senior",
    });
    await writeIssueStateStore(harness.workspaceDir, harness.project.slug, store);
    harness.provider.seedIssue({
      iid: issueId,
      title: "Build button",
      description: "Small UI component",
      labels: ["To Do", "developer:senior"],
    });

    try {
      const result = await projectTick({
        workspaceDir: harness.workspaceDir,
        projectSlug: harness.project.slug,
        provider: harness.provider,
        workflow: harness.workflow,
        runCommand: harness.runCommand,
        dryRun: true,
      });

      assert.equal(result.pickups.length, 1);
      assert.equal(result.pickups[0]?.role, "developer");
      assert.equal(result.pickups[0]?.level, "junior");
    } finally {
      await harness.cleanup();
    }
  });

  it("rechecks a queued candidate after waiting for its issue lock", async () => {
    const harness = await createTestHarness();
    const issueId = 79;
    const store = emptyIssueStateStore(harness.project.slug);

    store.issues[String(issueId)] = issueState(harness.project.slug, issueId);
    await writeIssueStateStore(harness.workspaceDir, harness.project.slug, store);
    harness.provider.seedIssue({ iid: issueId, title: "Build button", labels: ["To Do"] });

    let releaseLock: (() => void) | undefined;
    let lockAcquired: (() => void) | undefined;
    const mayRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    try {
      const blocker = withIssueOrchestrationLock(
        harness.workspaceDir,
        harness.project.slug,
        issueId,
        async () => {
          lockAcquired?.();
          await mayRelease;
        },
      );
      await acquired;

      const tick = projectTick({
        workspaceDir: harness.workspaceDir,
        projectSlug: harness.project.slug,
        provider: harness.provider,
        workflow: harness.workflow,
        runCommand: harness.runCommand,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.equal(harness.provider.callsTo("transitionLabel").length, 0);

      store.issues[String(issueId)] = issueState(harness.project.slug, issueId, {
        workflowState: "planning",
        workflowLabel: "Planning",
        assignedRole: null,
        assignedLevel: null,
      });
      await writeIssueStateStore(harness.workspaceDir, harness.project.slug, store);
      releaseLock?.();

      const result = await tick;

      await blocker;
      assert.equal(result.pickups.length, 0);
      assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
    } finally {
      releaseLock?.();
      await harness.cleanup();
    }
  });
});

function issueState(
  projectSlug: string,
  issueId: number,
  overrides: Partial<IssueRuntimeState> = {},
): IssueRuntimeState {
  return {
    projectSlug,
    issueId,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}
