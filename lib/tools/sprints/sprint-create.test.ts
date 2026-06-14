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
import {
  createSprintStructure,
  resolveSprintSteps,
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
    assert.strictEqual(graph.sprintBranch, "sprint/sprint-devclaw-sprint-mode");
    assert.deepStrictEqual(graph.steps.map((step) => step.prTargetBranch), [
      graph.sprintBranch,
      graph.sprintBranch,
      graph.sprintBranch,
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
    assert.strictEqual(provider.callsTo("editIssue").length, 1);
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
