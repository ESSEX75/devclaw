/**
 * Verifies application-owned projection interpretation before local runtime persistence.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_WORKFLOW, ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import { loadConfig, readIssueStateStore } from "../../state/index.js";
import {
  createEmptyIssueStateStoreForTesting as emptyIssueStateStore,
  createTestHarness,
  replaceIssueStateStoreForTesting as writeIssueStateStore,
} from "../../testing/index.js";
import { writeIssueRuntimeState } from "./write.js";
import type { IssueStateWriteInput } from "./types.js";

/** Run runtime-write scenarios against an isolated workspace with default configuration.
 * @param run - Assertions using a valid input whose issue does not initially exist.
 */
async function withRuntimeInput(run: (input: IssueStateWriteInput) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();

  try {
    await run({ workspaceDir: harness.workspaceDir, project: harness.project,
      issue: { iid: 123, labels: ["To Do"] }, providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW });
  } finally {
    await harness.cleanup();
  }
}

/** Build a complete current runtime record for projection-drift tests. */
function issueState(): IssueRuntimeState {
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
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    providerMissing: null,
    pipelineNotification: null,
  };
}

describe("writeIssueRuntimeState", () => {
  it("imports only configured custom role levels on initialization", async () => {
    await withRuntimeInput(async (input) => {
      const config = await loadConfig(input.workspaceDir);
      const developer = config.roles.developer!;
      const initialized = await writeIssueRuntimeState({ ...input,
        initializationRoles: { security_auditor: { ...developer, levels: { expert: developer.levels.senior! } } },
        issue: { iid: 123, labels: ["To Do", "priority:high", "developer:senior", "security_auditor:expert", "review:agent"] },
      });

      assert.equal(initialized.assignedRole, "security_auditor");
      assert.equal(initialized.assignedLevel, "expert");
      assert.equal(initialized.reviewPolicy, "agent");
      const withoutRoles = await writeIssueRuntimeState({ ...input,
        issue: { iid: 124, labels: ["To Do", "developer:senior", "priority:high"] },
      });

      assert.equal(withoutRoles.assignedRole, null);
      assert.equal(withoutRoles.assignedLevel, null);
      const invalidLevel = await writeIssueRuntimeState({ ...input, initializationRoles: config.roles,
        issue: { iid: 125, labels: ["To Do", "developer:unconfigured"] },
      });

      assert.equal(invalidLevel.assignedRole, null);
      assert.equal(invalidLevel.assignedLevel, null);
    });
  });

  it("does not combine an explicit role with a different projected role's level", async () => {
    await withRuntimeInput(async (input) => {
      const { roles } = await loadConfig(input.workspaceDir);
      const state = await writeIssueRuntimeState({ ...input, initializationRoles: roles,
        assignedRole: "tester", issue: { iid: 123, labels: ["To Do", "developer:senior"] },
      });

      assert.equal(state.assignedRole, "tester");
      assert.equal(state.assignedLevel, null);
    });
  });

  it("rejects ambiguous initialization and lets explicit choices override projection", async () => {
    await withRuntimeInput(async (input) => {
      const { roles } = await loadConfig(input.workspaceDir);

      for (const labels of [["To Do", "Doing"], ["To Do", "review:human", "review:agent"],
        ["To Do", "test:skip", "test:agent"], ["To Do", "developer:senior", "tester:junior"]]) {
        await assert.rejects(writeIssueRuntimeState({ ...input, initializationRoles: roles, issue: { iid: 123, labels } }));
        assert.equal((await readIssueStateStore(input.workspaceDir, input.project.slug)).issues["123"], undefined);
      }

      const explicit = await writeIssueRuntimeState({ ...input, initializationRoles: roles,
        issue: { iid: 123, labels: ["Doing", "To Do", "developer:senior", "tester:junior", "review:human", "review:agent"] },
        workflowState: "todo", assignedRole: null, assignedLevel: null, reviewPolicy: null,
      });

      assert.equal(explicit.workflowLabel, "To Do");
      assert.equal(explicit.assignedRole, null);
      assert.equal(explicit.assignedLevel, null);
      assert.equal(explicit.reviewPolicy, null);
    });
  });

  it("validates explicit state-label pairs and derives the omitted side", async () => {
    await withRuntimeInput(async (input) => {
      const before = await writeIssueRuntimeState(input);

      await assert.rejects(writeIssueRuntimeState({ ...input, providerType: ISSUE_PROVIDER.GITLAB }), /provider cannot change/);
      assert.deepEqual((await readIssueStateStore(input.workspaceDir, input.project.slug)).issues["123"], before);

      for (const transition of [{ workflowState: "doing", workflowLabel: "To Do" },
        { workflowState: "missing" }, { workflowLabel: "Missing" }]) {
        await assert.rejects(writeIssueRuntimeState({ ...input, ...transition }));
        assert.deepEqual((await readIssueStateStore(input.workspaceDir, input.project.slug)).issues["123"], before);
      }

      const byKey = await writeIssueRuntimeState({ ...input, workflowState: "doing" });

      assert.equal(byKey.workflowLabel, "Doing");
      const byLabel = await writeIssueRuntimeState({ ...input, workflowLabel: "To Review" });

      assert.equal(byLabel.workflowState, "toReview");
    });
  });

  it("preserves omitted values without provider labels and applies explicit nulls", async () => {
    await withRuntimeInput(async (input) => {
      const before = await writeIssueRuntimeState({ ...input,
        assignedRole: "developer", assignedLevel: "senior", owner: "main", reviewPolicy: "agent", testPolicy: "agent",
        notifyTarget: { channel: "telegram", name: "primary" },
        activeWorker: { role: "developer", level: "senior", slotIndex: 0, sessionKey: "worker", startedAt: new Date().toISOString() },
        closedAt: new Date().toISOString(),
      });
      const emptyProjection = { ...input, issue: { iid: 123, labels: [] } };
      const preserved = await writeIssueRuntimeState({ ...emptyProjection, assignedRole: undefined, reviewPolicy: undefined });

      assert.deepEqual({ ...preserved, updatedAt: before.updatedAt }, before);
      const cleared = await writeIssueRuntimeState({ ...emptyProjection, assignedRole: null, assignedLevel: null,
        owner: null, reviewPolicy: null, testPolicy: null, notifyTarget: null, activeWorker: null, closedAt: null });

      for (const field of ["assignedRole", "assignedLevel", "owner", "reviewPolicy", "testPolicy", "notifyTarget", "activeWorker", "closedAt"] as const) {
        assert.equal(cleared[field], null);
      }
    });
  });

  it("preserves explicit local nulls and workflow when provider labels drift", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-runtime-write-"));

    try {
      const previous = { ...issueState(), assignedRole: null, assignedLevel: null,
        reviewPolicy: null, testPolicy: null, owner: null };
      const store = emptyIssueStateStore("devclaw");

      store.issues["123"] = previous;
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const updated = await writeIssueRuntimeState({
        workspaceDir,
        project: { slug: "devclaw", channels: [] },
        issue: { iid: 123, labels: ["Doing", "tester:junior", "review:agent", "test:agent"] },
        providerType: ISSUE_PROVIDER.GITHUB,
        workflow: DEFAULT_WORKFLOW,
        owner: "new-owner",
      });

      assert.deepEqual({ ...updated, owner: previous.owner, updatedAt: previous.updatedAt }, previous);
      assert.equal(updated.owner, "new-owner");
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true });
    }
  });

  it("preserves local semantics when provider projection labels drift", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-runtime-write-"));

    try {
      const store = emptyIssueStateStore("devclaw");

      store.issues["123"] = issueState();
      await writeIssueStateStore(workspaceDir, "devclaw", store);
      const updated = await writeIssueRuntimeState({
        workspaceDir,
        project: { slug: "devclaw", channels: [] },
        issue: { iid: 123, labels: ["To Do", "tester:junior", "review:agent", "test:agent"] },
        providerType: ISSUE_PROVIDER.GITHUB,
        workflow: DEFAULT_WORKFLOW,
      });

      assert.equal(updated.assignedRole, "developer");
      assert.equal(updated.assignedLevel, "medior");
      assert.equal(updated.reviewPolicy, "human");
      assert.equal(updated.testPolicy, "skip");
      assert.equal((await readIssueStateStore(workspaceDir, "devclaw")).issues["123"]?.owner, "main");
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true });
    }
  });
});
