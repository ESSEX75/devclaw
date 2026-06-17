/**
 * Tests for sprint-aware task status summaries.
 *
 * Run: npx tsx --test lib/tools/tasks/sprint-status.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "../../projects/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { SprintStepStatus, updateSprintStepStatus } from "../../sprints/index.js";
import { DEFAULT_WORKFLOW } from "../../workflow/index.js";
import { createSprintStructure } from "../sprints/sprint-create.js";
import { buildSprintStatusSummaries } from "./sprint-status.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-sprint-status-"));
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
    workers: {
      developer: {
        levels: {
          senior: [{
            active: true,
            issueId: "3",
            sessionKey: "session-1",
            startTime: "2026-06-15T00:00:00.000Z",
            name: "Ada",
          }],
        },
      },
    },
  };
}

describe("buildSprintStatusSummaries", () => {
  it("renders sprint roots, step dependencies, progress, PR targets, and workers", async () => {
    const workspace = await makeWorkspace();
    const provider = new TestProvider();
    const project = projectFixture();

    const created = await createSprintStructure({
      workspaceDir: workspace,
      provider,
      project,
      workflow: DEFAULT_WORKFLOW,
      baseBranch: "main",
      input: {
        projectSlug: "devclaw",
        title: "Code memory plugin",
        description: "Build code memory",
        steps: [
          { id: "provider", title: "Provider contract" },
          { id: "queue", title: "Queue gating", dependsOn: ["provider"] },
        ],
      },
    });

    await provider.createPullRequest({
      title: "Provider contract",
      body: "Addresses issue",
      sourceBranch: "step/1-provider-contract",
      targetBranch: "sprint/sprint-code-memory-plugin",
      issueId: created.childIssues[0]!.iid,
    });

    await updateSprintStepStatus(
      workspace,
      "devclaw",
      created.rootIssue.iid,
      created.childIssues[0]!.iid,
      SprintStepStatus.MERGED,
      { prUrl: "https://example.com/pull/77" },
    );
    await updateSprintStepStatus(
      workspace,
      "devclaw",
      created.rootIssue.iid,
      created.childIssues[1]!.iid,
      SprintStepStatus.CONFLICT,
    );

    const summaries = await buildSprintStatusSummaries({ workspaceDir: workspace, project, provider });

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0]!.root.title, "Code memory plugin");
    assert.strictEqual(summaries[0]!.milestone, "sprint-code-memory-plugin");
    assert.strictEqual(summaries[0]!.sprintBranch, "sprint/sprint-code-memory-plugin");
    assert.deepStrictEqual(summaries[0]!.progress, { merged: 1, total: 2 });
    assert.strictEqual(summaries[0]!.steps[0]!.state, SprintStepStatus.MERGED);
    assert.strictEqual(summaries[0]!.steps[0]!.prUrl, "https://example.com/pull/77");
    assert.deepStrictEqual(summaries[0]!.steps[1]!.blockedBy, [created.childIssues[0]!.iid]);
    assert.strictEqual(summaries[0]!.steps[1]!.state, SprintStepStatus.CONFLICT);
    assert.strictEqual(summaries[0]!.steps[1]!.prTargetBranch, "sprint/sprint-code-memory-plugin");
    assert.strictEqual(summaries[0]!.steps[1]!.worker, "developer:senior:Ada");
  });
});
