/**
 * Tests for sprint merge policy pipeline.
 *
 * Run: npx tsx --test lib/sprints/merge-policy.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestProvider } from "../testing/test-provider.js";
import { writeProjects, type Project } from "../projects/index.js";
import { PrState } from "../providers/provider.js";
import { DEFAULT_WORKFLOW, ReviewPolicy, TaskMode } from "../workflow/index.js";
import {
  createSprintGraph,
  getSprintGraph,
  processSprintMergePolicy,
  resolveSprintMergePolicy,
  SprintGraphStatus,
  SprintStepStatus,
} from "./index.js";

async function makeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-sprint-merge-"));
  await fs.mkdir(path.join(workspace, "devclaw"), { recursive: true });
  await writeProjects(workspace, { projects: { devclaw: projectFixture() } });
  return workspace;
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

function workflow(policy: ReviewPolicy) {
  return { ...DEFAULT_WORKFLOW, taskMode: TaskMode.SPRINT, reviewPolicy: policy };
}

async function createGraph(workspace: string) {
  return createSprintGraph(workspace, {
    projectSlug: "devclaw",
    sprintRootIssueId: 100,
    milestone: "sprint-feature",
    sprintBranch: "sprint/100-feature",
    status: SprintGraphStatus.ACTIVE,
    sprintBlockedBy: [],
    steps: [
      { issueId: 101, order: 1, workBranch: "step/101", prTargetBranch: "sprint/100-feature", status: SprintStepStatus.REVIEW },
      { issueId: 102, order: 2, workBranch: "step/102", prTargetBranch: "sprint/100-feature", status: SprintStepStatus.MERGED, blockedBy: [101] },
    ],
  });
}

describe("sprint merge policy", () => {
  it("resolves human, sprint, and skip policies", () => {
    assert.deepStrictEqual(resolveSprintMergePolicy(workflow(ReviewPolicy.HUMAN)), {
      childAutoMerge: false,
      finalAutoMerge: false,
    });
    assert.deepStrictEqual(resolveSprintMergePolicy(workflow(ReviewPolicy.SPRINT)), {
      childAutoMerge: true,
      finalAutoMerge: false,
    });
    assert.deepStrictEqual(resolveSprintMergePolicy(workflow(ReviewPolicy.SKIP)), {
      childAutoMerge: true,
      finalAutoMerge: true,
    });
  });

  it("reviewPolicy: human never auto-merges sprint child PRs", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    await createGraph(workspace);
    provider.prStatuses.set(101, {
      state: PrState.OPEN,
      url: "https://example.com/pr/101",
      targetBranch: "sprint/100-feature",
      mergeable: true,
      checksPassed: true,
    });

    const result = await processSprintMergePolicy({
      workspaceDir: workspace,
      projectSlug: "devclaw",
      issueId: 101,
      provider,
      workflow: workflow(ReviewPolicy.HUMAN),
      projectBaseBranch: "main",
    });

    assert.strictEqual(result.childMerged, false);
    assert.strictEqual(provider.callsTo("mergePr").length, 0);
  });

  it("reviewPolicy: sprint auto-merges child PR and creates final PR without merging final", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    provider.seedIssue({ iid: 100, title: "Root", labels: [] });
    await createGraph(workspace);
    provider.prStatuses.set(101, {
      state: PrState.OPEN,
      url: "https://example.com/pr/101",
      targetBranch: "sprint/100-feature",
      mergeable: true,
      checksPassed: true,
    });

    const result = await processSprintMergePolicy({
      workspaceDir: workspace,
      projectSlug: "devclaw",
      issueId: 101,
      provider,
      workflow: workflow(ReviewPolicy.SPRINT),
      projectBaseBranch: "main",
    });
    const graph = await getSprintGraph(workspace, "devclaw", 100);

    assert.strictEqual(result.childMerged, true);
    assert.strictEqual(result.finalPrCreated, true);
    assert.strictEqual(result.finalMerged, false);
    assert.strictEqual(provider.callsTo("mergePr").length, 1);
    assert.deepStrictEqual(provider.callsTo("createPullRequest").at(-1)?.args, {
      title: "Finalize sprint-feature",
      body: "Final sprint PR for sprint-feature.",
      sourceBranch: "sprint/100-feature",
      targetBranch: "main",
      issueId: 100,
    });
    assert.strictEqual(graph?.steps.find((step) => step.issueId === 101)?.status, SprintStepStatus.MERGED);
  });

  it("reviewPolicy: skip marks final_review_required when final checks cannot be verified", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    provider.seedIssue({ iid: 100, title: "Root", labels: [] });
    await createGraph(workspace);
    provider.prStatuses.set(101, {
      state: PrState.OPEN,
      url: "https://example.com/pr/101",
      targetBranch: "sprint/100-feature",
      mergeable: true,
      checksPassed: true,
    });
    provider.prStatuses.set(100, {
      state: PrState.OPEN,
      url: "https://example.com/pr/final",
      targetBranch: "main",
      mergeable: true,
      checksPassed: undefined,
    });

    const result = await processSprintMergePolicy({
      workspaceDir: workspace,
      projectSlug: "devclaw",
      issueId: 101,
      provider,
      workflow: workflow(ReviewPolicy.SKIP),
      projectBaseBranch: "main",
    });
    const graph = await getSprintGraph(workspace, "devclaw", 100);

    assert.strictEqual(result.finalReviewRequired, true);
    assert.strictEqual(graph?.status, SprintGraphStatus.FINAL_REVIEW_REQUIRED);
    assert.strictEqual(provider.callsTo("mergePr").length, 1);
  });

  it("reviewPolicy: skip auto-merges final PR only after safe checks", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    provider.seedIssue({ iid: 100, title: "Root", labels: [] });
    await createGraph(workspace);
    provider.prStatuses.set(101, {
      state: PrState.OPEN,
      url: "https://example.com/pr/101",
      targetBranch: "sprint/100-feature",
      mergeable: true,
      checksPassed: true,
    });
    provider.prStatuses.set(100, {
      state: PrState.OPEN,
      url: "https://example.com/pr/final",
      targetBranch: "main",
      mergeable: true,
      checksPassed: true,
    });

    const result = await processSprintMergePolicy({
      workspaceDir: workspace,
      projectSlug: "devclaw",
      issueId: 101,
      provider,
      workflow: workflow(ReviewPolicy.SKIP),
      projectBaseBranch: "main",
    });
    const graph = await getSprintGraph(workspace, "devclaw", 100);

    assert.strictEqual(result.finalMerged, true);
    assert.strictEqual(graph?.status, SprintGraphStatus.DONE);
    assert.deepStrictEqual(provider.callsTo("mergePr").map((call) => call.args.issueId), [101, 100]);
    assert.strictEqual(provider.callsTo("closeIssue").at(-1)?.args.issueId, 100);
  });
});
