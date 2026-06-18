/**
 * Tests for sprint managed projection guard.
 *
 * Run: npx tsx --test lib/sprints/projection-guard.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestProvider } from "../testing/test-provider.js";
import {
  appendManagedSprintMetadata,
  createSprintGraph,
  expectedManagedLabelsForIssue,
  getSprintGraph,
  handleProjectionBodyChange,
  handleProjectionLabelChange,
  repairSprintProjectionFromLocalState,
  resolveStepReadiness,
  SprintGraphStatus,
  SprintStepStatus,
} from "./index.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-projection-guard-"));
}

function graphFixture() {
  return {
    projectSlug: "devclaw",
    sprintRootIssueId: 100,
    milestone: "sprint-devclaw-sprint-mode",
    sprintBranch: "sprint/devclaw-sprint-mode",
    status: SprintGraphStatus.ACTIVE,
    sprintBlockedBy: [],
    steps: [
      {
        issueId: 101,
        order: 1,
        workBranch: "step/101-config",
        prTargetBranch: "sprint/devclaw-sprint-mode",
        status: SprintStepStatus.READY,
      },
      {
        issueId: 102,
        order: 2,
        workBranch: "step/102-guard",
        prTargetBranch: "sprint/devclaw-sprint-mode",
        blockedBy: [101],
        status: SprintStepStatus.BLOCKED,
      },
    ],
  };
}

function seedProvider(provider: TestProvider): void {
  provider.seedIssue({
    iid: 100,
    title: "Sprint root",
    description: "root body",
    labels: [],
  });
  provider.seedIssue({
    iid: 101,
    title: "Step 1",
    description: "step 1",
    labels: [],
  });
  provider.seedIssue({
    iid: 102,
    title: "Step 2",
    description: "step 2",
    labels: [],
  });
}

async function readAuditEvents(workspace: string): Promise<string[]> {
  const auditPath = path.join(workspace, "devclaw", "log", "audit.log");
  const raw = await fs.readFile(auditPath, "utf-8");
  return raw.trim().split("\n").map((line) => JSON.parse(line).event);
}

describe("sprint managed projection guard", () => {
  it("restores removed blocked:step label when the local graph says the step is blocked", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, graphFixture());

    const result = await handleProjectionLabelChange({
      workspaceDir: workspace,
      provider,
      graph,
      issueId: 102,
      label: "blocked:step",
      action: "removed",
    });

    assert.deepStrictEqual(result, { action: "restored", restored: ["blocked:step"] });
    assert.deepStrictEqual(provider.callsTo("addLabel").at(-1)?.args, {
      issueId: 102,
      label: "blocked:step",
    });
    assert.ok((await readAuditEvents(workspace)).includes("sprint_projection_label_restored"));
  });

  it("restores removed step label when the local graph contains the child issue", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, graphFixture());

    const result = await handleProjectionLabelChange({
      workspaceDir: workspace,
      provider,
      graph,
      issueId: 102,
      label: "step:102",
      action: "removed",
    });

    assert.deepStrictEqual(result, { action: "restored", restored: ["step:102"] });
    assert.deepStrictEqual(provider.callsTo("addLabel").at(-1)?.args, {
      issueId: 102,
      label: "step:102",
    });
  });

  it("restores removed sprint slug label from local graph projection", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, graphFixture());
    const label = "sprint:sprint-devclaw-sprint-mode";

    await handleProjectionLabelChange({
      workspaceDir: workspace,
      provider,
      graph,
      issueId: 100,
      label,
      action: "removed",
    });

    assert.deepStrictEqual(provider.callsTo("addLabel").at(-1)?.args, {
      issueId: 100,
      label,
    });
  });

  it("removes unexpected managed labels and ignores unmanaged labels", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, graphFixture());

    const unmanaged = await handleProjectionLabelChange({
      workspaceDir: workspace,
      provider,
      graph,
      issueId: 101,
      label: "priority:high",
      action: "added",
    });
    const managed = await handleProjectionLabelChange({
      workspaceDir: workspace,
      provider,
      graph,
      issueId: 101,
      label: "blocked:manual",
      action: "added",
    });

    assert.deepStrictEqual(unmanaged, { action: "ignored", restored: [] });
    assert.deepStrictEqual(managed, { action: "restored", restored: ["blocked:manual"] });
    assert.deepStrictEqual(provider.callsTo("removeLabels").at(-1)?.args, {
      issueId: 101,
      labels: ["blocked:manual"],
    });
  });

  it("does not add blocked:step to ready children during repair", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, graphFixture());

    await repairSprintProjectionFromLocalState({
      workspaceDir: workspace,
      provider,
      graph,
    });

    assert.strictEqual(provider.issues.get(101)?.labels.includes("step:101"), true);
    assert.strictEqual(provider.issues.get(101)?.labels.includes("blocked:step"), false);
    assert.strictEqual(provider.issues.get(102)?.labels.includes("step:102"), true);
    assert.strictEqual(provider.issues.get(102)?.labels.includes("blocked:step"), true);
  });

  it("marks sprint integrity_error when managed metadata is tampered and blocks readiness", async () => {
    const workspace = await makeWorkspace();
    const graph = await createSprintGraph(workspace, graphFixture());
    const previousBody = appendManagedSprintMetadata("root body", graph);
    const nextBody = previousBody.replace('"projectSlug":"devclaw"', '"projectSlug":"other"');

    const result = await handleProjectionBodyChange({
      workspaceDir: workspace,
      graph,
      issueId: 100,
      previousBody,
      nextBody,
    });
    const updated = await getSprintGraph(workspace, "devclaw", 100);

    assert.strictEqual(result.action, "integrity_error");
    assert.strictEqual(updated?.status, SprintGraphStatus.INTEGRITY_ERROR);
    assert.deepStrictEqual(resolveStepReadiness(updated!, 101), {
      ready: false,
      blockedBy: [],
      reason: "integrity_error",
    });
  });

  it("ignores unmanaged body edits outside the metadata block", async () => {
    const workspace = await makeWorkspace();
    const graph = await createSprintGraph(workspace, graphFixture());
    const previousBody = appendManagedSprintMetadata("root body", graph);
    const nextBody = previousBody.replace("root body", "updated root body");

    const result = await handleProjectionBodyChange({
      workspaceDir: workspace,
      graph,
      issueId: 100,
      previousBody,
      nextBody,
    });
    const updated = await getSprintGraph(workspace, "devclaw", 100);

    assert.deepStrictEqual(result, { action: "ignored", integrityErrors: [] });
    assert.strictEqual(updated?.status, SprintGraphStatus.ACTIVE);
  });

  it("repairs provider projection from local state and clears integrity_error", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedProvider(provider);
    const graph = await createSprintGraph(workspace, {
      ...graphFixture(),
      status: SprintGraphStatus.INTEGRITY_ERROR,
    });

    const result = await repairSprintProjectionFromLocalState({
      workspaceDir: workspace,
      provider,
      graph,
    });
    const updated = await getSprintGraph(workspace, "devclaw", 100);

    assert.ok(result.repaired.includes("label:102:blocked:step"));
    assert.ok(result.repaired.includes("label:101:step:101"));
    assert.ok(result.repaired.includes("label:102:step:102"));
    assert.strictEqual(updated?.status, SprintGraphStatus.ACTIVE);
    assert.deepStrictEqual(
      expectedManagedLabelsForIssue(graph, 100).filter((label) => label.startsWith("sprint:")),
      ["sprint:root", "sprint:sprint-devclaw-sprint-mode"],
    );
    assert.ok(provider.callsTo("editIssue").at(-1)?.args.updates.body?.includes("devclaw:sprint-metadata"));
    assert.ok((await readAuditEvents(workspace)).includes("sprint_projection_repair"));
  });
});
