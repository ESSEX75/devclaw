/**
 * Tests for sprint_create helpers.
 *
 * Run: npx tsx --test lib/tools/sprints/sprint-create.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginContext } from "../../context.js";
import type { Project } from "../../projects/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { SprintStepStatus, readSprints } from "../../sprints/index.js";
import { createTaskCreateTool } from "../tasks/task-create.js";
import { DEFAULT_WORKFLOW, ReviewPolicy, TaskMode } from "../../workflow/index.js";
import {
  createSprintStructure,
  resolveSprintSteps,
  slugPart,
  toSprintBranchName,
  toSprintWorkBranchName,
  validateSprintCreateInput,
} from "./sprint-create.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-sprint-create-"));
}

function projectFixture(): Project {
  return {
    slug: "devclaw",
    name: "DevClaw",
    repo: "/tmp/devclaw",
    groupName: "DevClaw",
    deployUrl: "",
    baseBranch: "main",
    deployBranch: "main",
    provider: "github",
    channels: [{ channelId: "-100", channel: "telegram", name: "primary", events: ["*"] }],
    workers: {},
  };
}

describe("sprint_create input and graph", () => {
  it("normalizes predictable sprint branch names", () => {
    assert.strictEqual(
      toSprintBranchName(100, "Sprint: DevClaw   sprint mode!!!"),
      "sprint/100-sprint-devclaw-sprint-mode",
    );
    assert.strictEqual(
      toSprintWorkBranchName(100, "Sprint: DevClaw mode", 201, "Config & Validation"),
      "sprint/100-sprint-devclaw-mode/task/201-config-validation",
    );
    assert.strictEqual(slugPart(" -- "), "sprint");
    assert.strictEqual(slugPart("A".repeat(100)).length, 80);
  });

  it("defaults dependency graph to a linear chain", () => {
    const steps = resolveSprintSteps([
      { id: "config", title: "Config" },
      { id: "provider", title: "Provider" },
      { id: "scanner", title: "Scanner" },
    ]);

    assert.deepStrictEqual(steps.map((step) => step.dependsOn), [
      [],
      ["config"],
      ["provider"],
    ]);
  });

  it("accepts explicit parallel/custom dependencies", () => {
    const steps = resolveSprintSteps([
      { id: "config", title: "Config" },
      { id: "provider", title: "Provider", dependsOn: [] },
      { id: "scanner", title: "Scanner", dependsOn: ["config", "provider"] },
    ]);

    assert.deepStrictEqual(steps.map((step) => step.dependsOn), [
      [],
      [],
      ["config", "provider"],
    ]);
  });

  it("rejects duplicate and unknown dependency ids", () => {
    assert.throws(
      () => resolveSprintSteps([
        { id: "config", title: "Config" },
        { id: "config", title: "Duplicate" },
      ]),
      /Duplicate sprint step id/,
    );
    assert.throws(
      () => resolveSprintSteps([
        { id: "config", title: "Config", dependsOn: ["missing"] },
      ]),
      /depends on unknown step/,
    );
  });

  it("validates required input fields", () => {
    assert.throws(() => validateSprintCreateInput({ projectSlug: "p", title: "t", steps: [] }), /steps/);
    assert.throws(() => validateSprintCreateInput({ projectSlug: "p", steps: [{ id: "a", title: "A" }] }), /title/);
    assert.throws(
      () => validateSprintCreateInput({ projectSlug: "p", title: "t", steps: [{ id: "a", title: "A" }], sprintBlockedBy: ["abc"] }),
      /Invalid issue id/,
    );
  });

  it("creates provider projection and persists local sprint graph", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();

    const result = await createSprintStructure({
      workspaceDir: workspace,
      provider,
      project: projectFixture(),
      workflow: DEFAULT_WORKFLOW,
      baseBranch: "main",
      input: {
        projectSlug: "devclaw",
        title: "DevClaw sprint mode",
        description: "Build sprint mode",
        steps: [
          { id: "config", title: "Config" },
          { id: "provider", title: "Provider", dependsOn: [] },
          { id: "scanner", title: "Scanner", dependsOn: ["config", "provider"] },
        ],
        sprintBlockedBy: ["#42"],
      },
    });

    const data = await readSprints(workspace);
    const graph = data.sprints[`devclaw:${result.rootIssue.iid}`]!;

    assert.strictEqual(result.childIssues.length, 3);
    assert.strictEqual(graph.sprintBlockedBy[0], 42);
    assert.strictEqual(graph.sprintBranch, `sprint/${result.rootIssue.iid}-sprint-devclaw-sprint-mode`);
    assert.deepStrictEqual(graph.steps.map((step) => step.prTargetBranch), [
      graph.sprintBranch,
      graph.sprintBranch,
      graph.sprintBranch,
    ]);
    assert.deepStrictEqual(graph.steps.map((step) => step.workBranch), [
      `${graph.sprintBranch}/task/${result.childIssues[0]!.iid}-config`,
      `${graph.sprintBranch}/task/${result.childIssues[1]!.iid}-provider`,
      `${graph.sprintBranch}/task/${result.childIssues[2]!.iid}-scanner`,
    ]);
    assert.deepStrictEqual(graph.steps.map((step) => step.status), [
      SprintStepStatus.BLOCKED,
      SprintStepStatus.BLOCKED,
      SprintStepStatus.BLOCKED,
    ]);
    assert.deepStrictEqual(graph.steps[2]?.blockedBy, [
      result.childIssues[0]!.iid,
      result.childIssues[1]!.iid,
    ]);
    assert.strictEqual(provider.callsTo("createSprintMilestone").length, 1);
    assert.strictEqual(provider.callsTo("createSprintBranch").length, 1);
    assert.strictEqual(provider.callsTo("linkChildIssue").length, 3);
    assert.deepStrictEqual(
      provider.callsTo("linkIssueDependency").map((call) => call.args),
      [
        { blockedIssueId: result.childIssues[2]!.iid, blockingIssueId: result.childIssues[0]!.iid },
        { blockedIssueId: result.childIssues[2]!.iid, blockingIssueId: result.childIssues[1]!.iid },
      ],
    );
    assert.strictEqual(provider.callsTo("editIssue").length, 1);
  });

  it("projects developer queue label onto sprint children while preserving routing labels", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();

    const result = await createSprintStructure({
      workspaceDir: workspace,
      provider,
      project: projectFixture(),
      workflow: DEFAULT_WORKFLOW,
      baseBranch: "main",
      input: {
        projectSlug: "devclaw",
        title: "Routing labels",
        steps: [
          {
            id: "ready",
            title: "Ready step",
            labels: ["developer:junior", "review:human", "test:skip", "owner:main", "notify:telegram:direct"],
          },
          {
            id: "blocked",
            title: "Blocked step",
            labels: ["tester:senior", "reviewer:junior", "review:agent", "review:skip"],
          },
        ],
      },
    });

    const rootLabels = new Set(result.rootIssue.labels);
    assert.strictEqual(rootLabels.has("To Do"), false);
    assert.strictEqual(rootLabels.has(`step:${result.rootIssue.iid}`), false);
    assert.strictEqual([...rootLabels].some((label) => label.startsWith("step:")), false);
    assert.strictEqual(rootLabels.has("blocked:step"), false);

    const readyLabels = new Set(result.childIssues[0]!.labels);
    assert.strictEqual(readyLabels.has("To Do"), true);
    assert.strictEqual(readyLabels.has("devclaw:sprint"), true);
    assert.strictEqual(readyLabels.has("sprint:child"), true);
    assert.strictEqual(readyLabels.has("step:1"), true);
    assert.strictEqual(readyLabels.has(`step:${result.childIssues[0]!.iid}`), false);
    assert.strictEqual(readyLabels.has("blocked:step"), false);
    assert.strictEqual(readyLabels.has("developer:junior"), true);
    assert.strictEqual(readyLabels.has("review:human"), true);
    assert.strictEqual(readyLabels.has("test:skip"), true);
    assert.strictEqual(readyLabels.has("owner:main"), true);
    assert.strictEqual(readyLabels.has("notify:telegram:direct"), true);

    const blockedLabels = new Set(result.childIssues[1]!.labels);
    assert.strictEqual(blockedLabels.has("To Do"), true);
    assert.strictEqual(blockedLabels.has("tester:senior"), true);
    assert.strictEqual(blockedLabels.has("reviewer:junior"), true);
    assert.strictEqual(blockedLabels.has("review:agent"), true);
    assert.strictEqual(blockedLabels.has("review:skip"), true);
    assert.strictEqual(blockedLabels.has("step:2"), true);
    assert.strictEqual(blockedLabels.has(`step:${result.childIssues[1]!.iid}`), false);
    assert.strictEqual(blockedLabels.has("blocked:step"), true);
  });

  it("uses review:sprint for sprint child issues", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();

    const result = await createSprintStructure({
      workspaceDir: workspace,
      provider,
      project: projectFixture(),
      workflow: { ...DEFAULT_WORKFLOW, taskMode: TaskMode.SPRINT, reviewPolicy: ReviewPolicy.SPRINT },
      baseBranch: "main",
      input: {
        projectSlug: "devclaw",
        title: "Sprint review routing",
        steps: [
          { id: "one", title: "Step one", labels: ["developer:junior", "review:human"] },
        ],
      },
    });

    const childLabels = new Set(result.childIssues[0]!.labels);
    const graph = (await readSprints(workspace)).sprints[`devclaw:${result.rootIssue.iid}`]!;

    assert.strictEqual(childLabels.has("review:sprint"), true);
    assert.strictEqual(childLabels.has("review:human"), false);
    assert.strictEqual(graph.reviewPolicy, ReviewPolicy.SPRINT);
  });

  it("keeps task_create scoped to standalone issues", () => {
    const ctx = {
      runCommand: async () => ({ stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: null }),
    } as unknown as PluginContext;
    const tool = createTaskCreateTool(ctx)({ workspaceDir: "/tmp/workspace" } as any);

    assert.strictEqual(tool.name, "task_create");
    assert.deepStrictEqual(tool.parameters.required, ["channelId", "title"]);
    assert.strictEqual("steps" in tool.parameters.properties, false);
    assert.strictEqual("sprintBlockedBy" in tool.parameters.properties, false);
  });
});
