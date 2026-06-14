/**
 * Tests for local sprint execution graph.
 *
 * Run: npx tsx --test lib/sprints/state.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSprintGraph,
  getReadySprintSteps,
  getSprintGraph,
  listSprintGraphs,
  markSprintRepaired,
  markStepBlocked,
  markStepDispatched,
  markStepMerged,
  markStepUnblocked,
  readSprints,
  resolveStepReadiness,
  SprintGraphStatus,
  SprintStepStatus,
} from "./index.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-sprints-"));
}

function graphFixture() {
  return {
    projectSlug: "devclaw",
    sprintRootIssueId: 100,
    milestone: "sprint-100-devclaw-sprint-mode",
    sprintBranch: "sprint/100-devclaw-sprint-mode",
    status: SprintGraphStatus.ACTIVE,
    sprintBlockedBy: [],
    steps: [
      {
        issueId: 101,
        order: 1,
        workBranch: "step/101-workflow-config",
        prTargetBranch: "sprint/100-devclaw-sprint-mode",
        status: SprintStepStatus.READY,
      },
      {
        issueId: 102,
        order: 2,
        workBranch: "step/102-provider-contract",
        prTargetBranch: "sprint/100-devclaw-sprint-mode",
        blockedBy: [101],
        status: SprintStepStatus.BLOCKED,
      },
    ],
  };
}

async function readAuditEvents(workspace: string): Promise<string[]> {
  const auditPath = path.join(workspace, "devclaw", "log", "audit.log");
  const raw = await fs.readFile(auditPath, "utf-8");
  return raw.trim().split("\n").map((line) => JSON.parse(line).event);
}

describe("local sprint execution graph", () => {
  it("persists graph and survives reload", async () => {
    const workspace = await makeWorkspace();

    await createSprintGraph(workspace, graphFixture());
    const firstRead = await getSprintGraph(workspace, "devclaw", 100);
    const secondRead = await readSprints(workspace);
    const listed = await listSprintGraphs(workspace, "devclaw");

    assert.strictEqual(firstRead?.sprintRootIssueId, 100);
    assert.strictEqual(secondRead.sprints["devclaw:100"]?.steps.length, 2);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0]?.steps[0]?.issueId, 101);
  });

  it("resolves step-level dependencies from local graph only", async () => {
    const workspace = await makeWorkspace();
    const graph = await createSprintGraph(workspace, graphFixture());

    assert.deepStrictEqual(resolveStepReadiness(graph, 101), {
      ready: true,
      blockedBy: [],
      reason: "ready",
    });
    assert.deepStrictEqual(resolveStepReadiness(graph, 102), {
      ready: false,
      blockedBy: [101],
      reason: "step_blocked",
    });

    const merged = await markStepMerged(workspace, "devclaw", 100, 101, {
      prUrl: "https://example.com/pr/101",
    });
    assert.deepStrictEqual(resolveStepReadiness(merged, 102), {
      ready: true,
      blockedBy: [],
      reason: "ready",
    });
    assert.deepStrictEqual(getReadySprintSteps(merged).map((step) => step.issueId), [102]);
  });

  it("supports sprint-level dependencies", async () => {
    const workspace = await makeWorkspace();
    const graph = await createSprintGraph(workspace, {
      ...graphFixture(),
      sprintBlockedBy: [99],
    });

    assert.deepStrictEqual(resolveStepReadiness(graph, 101), {
      ready: false,
      blockedBy: [99],
      reason: "sprint_blocked",
    });
  });

  it("writes audit events for create, dispatch, block, unblock, merge, and repair", async () => {
    const workspace = await makeWorkspace();

    await createSprintGraph(workspace, graphFixture());
    await markStepDispatched(workspace, "devclaw", 100, 101);
    await markStepBlocked(workspace, "devclaw", 100, 102);
    await markStepUnblocked(workspace, "devclaw", 100, 102);
    await markStepMerged(workspace, "devclaw", 100, 101);
    await markSprintRepaired(workspace, "devclaw", 100, ["metadata"]);

    assert.deepStrictEqual(await readAuditEvents(workspace), [
      "sprint_graph_create",
      "sprint_step_dispatch",
      "sprint_step_block",
      "sprint_step_unblock",
      "sprint_step_merge",
      "sprint_graph_repair",
    ]);
  });

  it("does not let provider labels or body metadata mutate readiness", async () => {
    const workspace = await makeWorkspace();
    const graph = await createSprintGraph(workspace, graphFixture());

    const providerProjection = {
      labels: ["Done", "blocked:dep", "sprint:child"],
      bodyMetadata: { status: "done", blockedBy: [] },
    };
    assert.ok(providerProjection.labels.includes("Done"));
    assert.strictEqual(providerProjection.bodyMetadata.status, "done");

    assert.deepStrictEqual(resolveStepReadiness(graph, 102), {
      ready: false,
      blockedBy: [101],
      reason: "step_blocked",
    });
  });
});
