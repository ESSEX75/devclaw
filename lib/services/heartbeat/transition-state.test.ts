import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunCommand } from "../../context.js";
import { readIssueStateStore, writeIssueRuntimeState } from "../../issues/index.js";
import type { Project } from "../../projects/index.js";
import { renderIssueMetadata } from "../../projection/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../../domain/workflow/index.js";
import { projectionIntegrityPass } from "./projection.js";
import { reviewPass } from "./review.js";
import { testSkipPass } from "./test-skip.js";

async function withProject<T>(fn: (ctx: {
  workspaceDir: string;
  project: Project;
  provider: TestProvider;
  runCommand: RunCommand;
}) => Promise<T>): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-heartbeat-state-"));
  const project: Project = {
    slug: "test-project",
    name: "test-project",
    repo: "/tmp/test-repo",
    groupName: "Test Group",
    deployUrl: "",
    baseBranch: "main",
    deployBranch: "main",
    channels: [{ channelId: "-123", channel: "telegram", name: "primary", events: ["*"] }],
    provider: "github",
    workers: {},
  };
  const provider = new TestProvider();
  const runCommand: RunCommand = async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
    code: 0,
    signal: null,
    killed: false as const,
    termination: "exit" as const,
  } as any);
  try {
    return await fn({ workspaceDir, project, provider, runCommand });
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

describe("heartbeat transition state sync", () => {
  it("updates issues.json after human review transition so projection does not roll labels back", async () => {
    await withProject(async ({ workspaceDir, project, provider, runCommand }) => {
      const issue = provider.seedIssue({
        iid: 90,
        title: "Reviewed task",
        labels: ["To Review", "review:human", "test:skip"],
        description: renderIssueMetadata({ projectSlug: project.slug, issueId: 90, projectionVersion: 1 }),
      });
      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue,
        providerType: "github",
        workflow: DEFAULT_WORKFLOW,
        workflowState: "toReview",
        workflowLabel: "To Review",
        reviewPolicy: "human",
        testPolicy: "skip",
      });
      provider.setPrStatus(90, { state: "approved", url: "https://example.com/pr/90" });

      const transitions = await reviewPass({
        workspaceDir,
        projectName: project.name,
        project,
        workflow: DEFAULT_WORKFLOW,
        provider,
        repoPath: "/tmp/test-repo",
        runCommand,
      });
      const store = await readIssueStateStore(workspaceDir, project.slug);
      const projection = await projectionIntegrityPass({
        workspaceDir,
        project,
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer", "reviewer", "tester"],
      });

      assert.strictEqual(transitions, 1);
      assert.strictEqual(store.issues["90"]!.workflowState, "toTest");
      assert.strictEqual(store.issues["90"]!.workflowLabel, "To Test");
      assert.strictEqual(projection.repaired, 0);
      assert.strictEqual(provider.callsTo("listIssuesByLabel").length, 0);
    });
  });

  it("updates issues.json and closedAt after test skip transition", async () => {
    await withProject(async ({ workspaceDir, project, provider }) => {
      const issue = provider.seedIssue({
        iid: 91,
        title: "Test skipped task",
        labels: ["To Test", "review:human", "test:skip"],
        description: renderIssueMetadata({ projectSlug: project.slug, issueId: 91, projectionVersion: 1 }),
      });
      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue,
        providerType: "github",
        workflow: DEFAULT_WORKFLOW,
        workflowState: "toTest",
        workflowLabel: "To Test",
        reviewPolicy: "human",
        testPolicy: "skip",
      });

      const transitions = await testSkipPass({
        workspaceDir,
        projectName: project.name,
        project,
        workflow: DEFAULT_WORKFLOW,
        provider,
      });
      const store = await readIssueStateStore(workspaceDir, project.slug);

      assert.strictEqual(transitions, 1);
      assert.strictEqual(store.issues["91"]!.workflowState, "done");
      assert.strictEqual(store.issues["91"]!.workflowLabel, "Done");
      assert.ok(store.issues["91"]!.closedAt);
      assert.strictEqual(provider.callsTo("listIssuesByLabel").length, 0);
    });
  });
});
