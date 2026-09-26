/** Exercises persisted transitions, policy routing, and effects guarded by the issue lock. */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunCommand } from "../../context.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { readIssueArchiveStore, readIssueStateStore } from "../../state/index.js";
import { renderIssueMetadata } from "../../projection/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL, type Project } from "../../domain/index.js";
import { DEFAULT_WORKFLOW } from "../../domain/index.js";
import { projectionIntegrityPass } from "./projection.js";
import { reviewPass } from "./review.js";
import { reviewSkipPass } from "./review-skip.js";
import { testSkipPass } from "./test-skip.js";
import { transitionHeartbeatIssue } from "./transition-state.js";

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
    agentId: "test-agent",
    repo: "/tmp/test-repo",
    baseBranch: "main",
    deployBranch: "main",
    channels: [{
      channelId: "-123",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "default",
    }],
    provider: ISSUE_PROVIDER.GITHUB,
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
  it("does not execute provider actions for a stale local source state", async () => {
    await withProject(async ({ workspaceDir, project, provider }) => {
      const issue = provider.seedIssue({ iid: 88, labels: ["To Test"] });
      await writeIssueRuntimeState({
        workspaceDir, project, issue, providerType: project.provider,
        workflow: DEFAULT_WORKFLOW, workflowState: "toTest", workflowLabel: "To Test",
      });
      let actionCalled = false;
      const transitioned = await transitionHeartbeatIssue({
        workspaceDir, project, issueId: 88, provider, workflow: DEFAULT_WORKFLOW,
        fromLabel: "To Review", workflowState: "toImprove", workflowLabel: "To Improve",
        owner: "test",
        beforeCommit: async () => { actionCalled = true; await provider.mergePr(88); },
      });
      assert.equal(transitioned, false);
      assert.equal(actionCalled, false);
      assert.equal(provider.callsTo("transitionLabel").length, 0);
      assert.equal(provider.callsTo("mergePr").length, 0);
    });
  });

  it("does not merge when review policy changed after candidate selection", async () => {
    await withProject(async ({ workspaceDir, project, provider }) => {
      const issue = provider.seedIssue({ iid: 87, labels: ["To Review"] });
      await writeIssueRuntimeState({
        workspaceDir, project, issue, providerType: project.provider,
        workflow: DEFAULT_WORKFLOW, workflowState: "toReview", workflowLabel: "To Review",
        reviewPolicy: "agent",
      });
      const transitioned = await transitionHeartbeatIssue({
        workspaceDir, project, issueId: 87, provider, workflow: DEFAULT_WORKFLOW,
        fromLabel: "To Review", workflowState: "toTest", workflowLabel: "To Test",
        owner: "test", routing: { field: "reviewPolicy", value: "human" },
        beforeCommit: () => provider.mergePr(87),
      });
      assert.equal(transitioned, false);
      assert.equal(provider.callsTo("transitionLabel").length, 0);
      assert.equal(provider.callsTo("mergePr").length, 0);
    });
  });

  it("preserves local ownership when a provider owner label disagrees", async () => {
    await withProject(async ({ workspaceDir, project, provider }) => {
      const initialIssue = provider.seedIssue({
        iid: 89,
        title: "Ownership projection drift",
        labels: ["To Do", "owner:provider"],
      });
      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue: initialIssue,
        providerType: ISSUE_PROVIDER.GITHUB,
        workflow: DEFAULT_WORKFLOW,
        workflowState: "todo",
        workflowLabel: "To Do",
        owner: "local",
      });

      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue: initialIssue,
        providerType: ISSUE_PROVIDER.GITHUB,
        workflow: DEFAULT_WORKFLOW,
        workflowState: "doing",
        workflowLabel: "Doing",
      });

      const store = await readIssueStateStore(workspaceDir, project.slug);

      assert.strictEqual(store.issues["89"]!.owner, "local");
    });
  });

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
        providerType: ISSUE_PROVIDER.GITHUB,
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
        providerType: ISSUE_PROVIDER.GITHUB,
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
      const archive = await readIssueArchiveStore(workspaceDir, project.slug);
      const archived = Object.values(archive.issues).find((record) => record.issueId === 91);

      assert.strictEqual(transitions, 1);
      assert.strictEqual(store.issues["91"], undefined);
      assert.strictEqual(archived?.finalWorkflowState, "done");
      assert.strictEqual(archived?.finalWorkflowLabel, "Done");
      assert.ok(archived?.closedAt);
      assert.strictEqual(provider.callsTo("listIssuesByLabel").length, 0);
    });
  });

  it("review skip merges once and does nothing on a repeated pass", async () => {
    await withProject(async ({ workspaceDir, project, provider, runCommand }) => {
      const issue = provider.seedIssue({ iid: 92, labels: ["To Review", "review:skip"] });
      await writeIssueRuntimeState({
        workspaceDir, project, issue, providerType: project.provider,
        workflow: DEFAULT_WORKFLOW, workflowState: "toReview", workflowLabel: "To Review",
        reviewPolicy: "skip",
      });
      provider.setPrStatus(92, { state: "approved", url: "https://example.com/pr/92" });
      const input = {
        workspaceDir, projectName: project.name, project, workflow: DEFAULT_WORKFLOW,
        provider, repoPath: project.repo, runCommand,
      };

      assert.equal(await reviewSkipPass(input), 1);
      assert.equal(await reviewSkipPass(input), 0);
      assert.equal(provider.callsTo("mergePr").length, 1);
      assert.equal((await readIssueStateStore(workspaceDir, project.slug)).issues["92"]?.workflowLabel, "To Test");
    });
  });

  it("review skip preserves the configured direct-commit path when no PR exists", async () => {
    await withProject(async ({ workspaceDir, project, provider, runCommand }) => {
      const issue = provider.seedIssue({ iid: 93, labels: ["To Review", "review:skip"] });
      await writeIssueRuntimeState({
        workspaceDir, project, issue, providerType: project.provider,
        workflow: DEFAULT_WORKFLOW, workflowState: "toReview", workflowLabel: "To Review",
        reviewPolicy: "skip",
      });

      const count = await reviewSkipPass({
        workspaceDir, projectName: project.name, project, workflow: DEFAULT_WORKFLOW,
        provider, repoPath: project.repo, runCommand,
      });
      assert.equal(count, 1);
      assert.equal(provider.callsTo("mergePr").length, 0);
      assert.equal((await readIssueStateStore(workspaceDir, project.slug)).issues["93"]?.workflowLabel, "To Test");
    });
  });

  it("review skip routes failed merge to recovery without committing success", async () => {
    await withProject(async ({ workspaceDir, project, provider, runCommand }) => {
      const issue = provider.seedIssue({ iid: 94, labels: ["To Review", "review:skip"] });
      await writeIssueRuntimeState({
        workspaceDir, project, issue, providerType: project.provider,
        workflow: DEFAULT_WORKFLOW, workflowState: "toReview", workflowLabel: "To Review",
        reviewPolicy: "skip",
      });
      provider.setPrStatus(94, { state: "approved", url: "https://example.com/pr/94" });
      provider.mergePrFailures.add(94);

      const count = await reviewSkipPass({
        workspaceDir, projectName: project.name, project, workflow: DEFAULT_WORKFLOW,
        provider, repoPath: project.repo, runCommand,
      });
      assert.equal(count, 1);
      assert.equal(provider.callsTo("mergePr").length, 1);
      assert.equal((await readIssueStateStore(workspaceDir, project.slug)).issues["94"]?.workflowLabel, "To Improve");
    });
  });
});
