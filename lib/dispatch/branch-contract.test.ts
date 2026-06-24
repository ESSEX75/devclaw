/**
 * Tests for dispatch branch contract resolution and worker instructions.
 *
 * Run: npx tsx --test lib/dispatch/branch-contract.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "../projects/index.js";
import {
  createSprintGraph,
  SprintGraphStatus,
  SprintStepStatus,
} from "../sprints/index.js";
import { DEFAULT_WORKFLOW, TaskMode } from "../workflow/index.js";
import { resolveDispatchBranchContract } from "./branch-contract.js";
import { buildTaskMessage } from "./message-builder.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-branch-contract-"));
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

describe("dispatch branch contract", () => {
  it("resolves issue mode to project base branch", async () => {
    const contract = await resolveDispatchBranchContract({
      workspaceDir: await makeWorkspace(),
      project: projectFixture(),
      issueId: 42,
      issueTitle: "Add Login Page",
      workflow: { ...DEFAULT_WORKFLOW, taskMode: TaskMode.ISSUE },
    });

    assert.deepStrictEqual(contract, {
      mode: "issue",
      baseBranch: "main",
      workBranch: "issue/42-add-login-page",
      prTargetBranch: "main",
    });
  });

  it("resolves sprint child target to sprint branch", async () => {
    const workspace = await makeWorkspace();
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-feature",
      sprintBranch: "sprint/100-feature",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{
        issueId: 101,
        order: 1,
        workBranch: "step/101-config",
        prTargetBranch: "sprint/100-feature",
        status: SprintStepStatus.READY,
      }],
    });

    const contract = await resolveDispatchBranchContract({
      workspaceDir: workspace,
      project: projectFixture(),
      issueId: 101,
      issueTitle: "Config",
      workflow: { ...DEFAULT_WORKFLOW, taskMode: TaskMode.SPRINT },
    });

    assert.deepStrictEqual(contract, {
      mode: "sprint",
      baseBranch: "main",
      workBranch: "step/101-config",
      prTargetBranch: "sprint/100-feature",
      sprintRootIssueId: 100,
    });
  });

  it("fails sprint child dispatch when sprintBranch is missing", async () => {
    const workspace = await makeWorkspace();
    await createSprintGraph(workspace, {
      projectSlug: "devclaw",
      sprintRootIssueId: 100,
      milestone: "sprint-missing-branch",
      sprintBranch: "",
      status: SprintGraphStatus.ACTIVE,
      sprintBlockedBy: [],
      steps: [{
        issueId: 101,
        order: 1,
        workBranch: "step/101-config",
        prTargetBranch: "",
        status: SprintStepStatus.READY,
      }],
    });

    await assert.rejects(
      () => resolveDispatchBranchContract({
        workspaceDir: workspace,
        project: projectFixture(),
        issueId: 101,
        issueTitle: "Config",
        workflow: { ...DEFAULT_WORKFLOW, taskMode: TaskMode.SPRINT },
      }),
      /missing sprintBranch/,
    );
  });

  it("renders exact base, work, and PR target branches in worker message", () => {
    const message = buildTaskMessage({
      projectName: "DevClaw",
      channelId: "-100",
      role: "developer",
      issueId: 101,
      issueTitle: "Config",
      issueDescription: "Implement config",
      issueUrl: "https://example.com/issues/101",
      repo: "/tmp/devclaw",
      baseBranch: "main",
      branchContract: {
        mode: "sprint",
        baseBranch: "main",
        workBranch: "step/101-config",
        prTargetBranch: "sprint/100-feature",
        sprintRootIssueId: 100,
      },
    });

    assert.ok(message.includes("BASE BRANCH: main"));
    assert.ok(message.includes("WORK BRANCH: step/101-config"));
    assert.ok(message.includes("PR TARGET BRANCH: sprint/100-feature"));
    assert.ok(message.includes("SPRINT PR BODY MUST INCLUDE: Fixes #101"));
    assert.ok(!message.includes("Branch: main"));
  });

  it("does not add sprint PR body instructions for issue mode", () => {
    const message = buildTaskMessage({
      projectName: "DevClaw",
      channelId: "-100",
      role: "developer",
      issueId: 101,
      issueTitle: "Config",
      issueDescription: "Implement config",
      issueUrl: "https://example.com/issues/101",
      repo: "/tmp/devclaw",
      baseBranch: "main",
      branchContract: {
        mode: "issue",
        baseBranch: "main",
        workBranch: "issue/101-config",
        prTargetBranch: "main",
      },
    });

    assert.ok(!message.includes("SPRINT PR BODY MUST INCLUDE"));
  });
});
