/**
 * Tests for sprint dependency gating in queue scanner.
 *
 * Run: npx tsx --test lib/services/queue-scan.sprint.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestProvider } from "../testing/test-provider.js";
import {
  createSprintGraph,
  SprintGraphStatus,
  SprintStepStatus,
} from "../sprints/index.js";
import { DEFAULT_WORKFLOW, TaskMode, type WorkflowConfig } from "../workflow/index.js";
import { findDispatchableIssuesForRole } from "./queue-scan.js";

async function makeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-queue-sprint-"));
  await fs.mkdir(path.join(workspace, "devclaw"), { recursive: true });
  return workspace;
}

function sprintWorkflow(): WorkflowConfig {
  return { ...DEFAULT_WORKFLOW, taskMode: TaskMode.SPRINT };
}

function issueWorkflow(): WorkflowConfig {
  return { ...DEFAULT_WORKFLOW, taskMode: TaskMode.ISSUE };
}

function seedIssue(provider: TestProvider, iid: number, labels = ["To Do"]): void {
  provider.seedIssue({
    iid,
    title: `Issue ${iid}`,
    description: `Body ${iid}`,
    labels,
  });
}

async function scanDeveloperQueue(workspace: string, provider: TestProvider, workflow: WorkflowConfig = sprintWorkflow()) {
  return findDispatchableIssuesForRole(provider, "developer", workflow, {
    sprintGate: { workspaceDir: workspace, projectSlug: "devclaw" },
  });
}

describe("sprint queue scanner dependency gating", () => {
  it("does not dispatch step #2 while step #1 is not merged or done", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 101);
    seedIssue(provider, 102);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-linear",
      sprintBranch: "sprint/linear",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [
        { issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/linear", status: SprintStepStatus.READY },
        { issueId: 102, order: 2, workBranch: "step/102", prTargetBranch: "sprint/linear", status: SprintStepStatus.BLOCKED, blockedBy: [101] },
      ],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(result.matches.map((match) => match.issue.iid), [101]);
    assert.deepStrictEqual(result.skipped.map((skip) => skip.issueId), [102]);
    assert.match(result.skipped[0]!.reason, /step_blocked/);
  });

  it("dispatches parallel steps after their shared dependency is merged", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 101);
    seedIssue(provider, 102);
    seedIssue(provider, 103);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-parallel",
      sprintBranch: "sprint/parallel",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [
        { issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/parallel", status: SprintStepStatus.MERGED },
        { issueId: 102, order: 2, workBranch: "step/102", prTargetBranch: "sprint/parallel", status: SprintStepStatus.READY, blockedBy: [101] },
        { issueId: 103, order: 3, workBranch: "step/103", prTargetBranch: "sprint/parallel", status: SprintStepStatus.READY, blockedBy: [101] },
      ],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(new Set(result.matches.map((match) => match.issue.iid)), new Set([102, 103]));
  });

  it("allows independent sprint child issues to be dispatch candidates in the same scan", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 201);
    seedIssue(provider, 301);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 200,
      milestone: "sprint-a",
      sprintBranch: "sprint/a",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{ issueId: 201, order: 1, workBranch: "step/201", prTargetBranch: "sprint/a", status: SprintStepStatus.READY }],
    });
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 300,
      milestone: "sprint-b",
      sprintBranch: "sprint/b",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{ issueId: 301, order: 1, workBranch: "step/301", prTargetBranch: "sprint/b", status: SprintStepStatus.READY }],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(new Set(result.matches.map((match) => match.issue.iid)), new Set([201, 301]));
  });

  it("does not dispatch Sprint B while its sprint-level dependency is incomplete", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 201);
    seedIssue(provider, 301);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 200,
      milestone: "sprint-a",
      sprintBranch: "sprint/a",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{ issueId: 201, order: 1, workBranch: "step/201", prTargetBranch: "sprint/a", status: SprintStepStatus.READY }],
    });
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 300,
      milestone: "sprint-b",
      sprintBranch: "sprint/b",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [200],
      steps: [{ issueId: 301, order: 1, workBranch: "step/301", prTargetBranch: "sprint/b", status: SprintStepStatus.BLOCKED }],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(result.matches.map((match) => match.issue.iid), [201]);
    assert.deepStrictEqual(result.skipped.map((skip) => skip.issueId), [301]);
    assert.match(result.skipped[0]!.reason, /sprint_blocked/);
  });

  it("does not dispatch sprint roots or integrity_error sprint steps", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 100);
    seedIssue(provider, 101);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-integrity",
      sprintBranch: "sprint/integrity",
      status: SprintGraphStatus.INTEGRITY_ERROR,
      sprintBlockedBy: [],
      steps: [{ issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/integrity", status: SprintStepStatus.READY }],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(result.matches, []);
    assert.deepStrictEqual(new Set(result.skipped.map((skip) => skip.issueId)), new Set([100, 101]));
  });

  it("does not let blocked:step label alone control readiness", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 101, ["To Do", "blocked:step"]);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-label-projection",
      sprintBranch: "sprint/label-projection",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{ issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/label-projection", status: SprintStepStatus.READY }],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(result.matches.map((match) => match.issue.iid), [101]);
  });

  it("preserves issue mode behavior even when a graph exists", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 100);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-disabled",
      sprintBranch: "sprint/disabled",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [],
    });

    const result = await scanDeveloperQueue(workspace, provider, issueWorkflow());

    assert.deepStrictEqual(result.matches.map((match) => match.issue.iid), [100]);
  });

  it("dispatches standalone issues in sprint-enabled projects while skipping blocked sprint children", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    seedIssue(provider, 999);
    seedIssue(provider, 102);
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-with-standalone",
      sprintBranch: "sprint/with-standalone",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [
        { issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/with-standalone", status: SprintStepStatus.READY },
        { issueId: 102, order: 2, workBranch: "step/102", prTargetBranch: "sprint/with-standalone", status: SprintStepStatus.BLOCKED, blockedBy: [101] },
      ],
    });

    const result = await scanDeveloperQueue(workspace, provider);

    assert.deepStrictEqual(result.matches.map((match) => match.issue.iid), [999]);
    assert.deepStrictEqual(result.skipped.map((skip) => skip.issueId), [102]);
  });

});
