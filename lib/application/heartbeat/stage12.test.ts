/** Verifies heartbeat maintenance budgets, workspace ownership, and exact review routes. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { EXECUTION_MODE } from "../../domain/index.js";
import { renderIssueMetadata } from "../../projection/index.js";
import { DATA_DIR, readIssueStateStore } from "../../state/index.js";
import { updateIssueRuntimeRecord } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { discoverAgents } from "./service/agent-discovery.js";
import { processAllAgents } from "./service/agent-runner.js";
import { notifyReviewEvent } from "./review/review-notification.js";
import { mayScheduleProject } from "./scheduler.js";
import { tick } from "./tick-runner.js";

describe("heartbeat stage 12", () => {
  it("continues ordered maintenance for every owned project after a zero pickup budget", async () => {
    const harness = await createTestHarness();

    try {
      const registry = await harness.readProjects();

      registry.projects["second-project"] = { ...structuredClone(harness.project), slug: "second-project", name: "second-project",
        channels: [{ ...harness.project.channels[0], channelId: "second-channel" }] };
      registry.projects["foreign-project"] = { ...structuredClone(harness.project), slug: "foreign-project", name: "foreign-project", agentId: "other-agent",
        channels: [{ ...harness.project.channels[0], channelId: "foreign-channel" }] };
      await harness.writeProjects(registry);
      const result = await tick({ workspaceDir: harness.workspaceDir, agentId: harness.project.agentId,
        config: { enabled: true, intervalSeconds: 60, maxPickupsPerTick: 0 }, providerFactory: async () => harness.provider,
        sessions: null, logger: { info() {}, warn() {} }, runCommand: harness.runCommand });

      assert.equal(result.totalPickups, 0);
      assert.deepEqual([...new Set(result.passes.map(pass => pass.projectSlug))], [harness.project.slug, "second-project"]);
      assert.equal(result.passes.filter(pass => pass.name === "test_skip").length, 2);
      assert.equal(result.passes.some(pass => pass.projectSlug === "foreign-project"), false);
    } finally { await harness.cleanup(); }
  });

  it("runs later workflow policies after review failure and blocks project pickup", async () => {
    const harness = await createTestHarness();

    try {
      const human = harness.provider.seedIssue({ iid: 101, labels: ["To Review"],
        description: renderIssueMetadata({ projectSlug: harness.project.slug, issueId: 101 }) });
      const skippedTest = harness.provider.seedIssue({ iid: 102, labels: ["To Test"],
        description: renderIssueMetadata({ projectSlug: harness.project.slug, issueId: 102 }) });
      const queued = harness.provider.seedIssue({ iid: 103, labels: ["To Do"],
        description: renderIssueMetadata({ projectSlug: harness.project.slug, issueId: 103 }) });

      await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue: human,
        providerType: harness.project.provider, workflow: harness.workflow, workflowState: "toReview", workflowLabel: "To Review",
        reviewPolicy: "human" });
      await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue: skippedTest,
        providerType: harness.project.provider, workflow: harness.workflow, workflowState: "toTest", workflowLabel: "To Test",
        testPolicy: "skip" });
      await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue: queued,
        providerType: harness.project.provider, workflow: harness.workflow, workflowState: "todo", workflowLabel: "To Do" });

      const getPrStatus = harness.provider.getPrStatus.bind(harness.provider);

      harness.provider.getPrStatus = async (issueId) => {
        if (issueId === human.iid) throw new Error("PR read failed");

        return getPrStatus(issueId);
      };
      const warnings: string[] = [];
      const result = await tick({ workspaceDir: harness.workspaceDir, agentId: harness.project.agentId,
        config: { enabled: true, intervalSeconds: 60, maxPickupsPerTick: 1 }, providerFactory: async () => harness.provider,
        sessions: null, logger: { info() {}, warn(message) { warnings.push(message); } }, runCommand: harness.runCommand });
      const store = await readIssueStateStore(harness.workspaceDir, harness.project.slug);

      assert.deepEqual(result.passes.map((pass) => pass.name), [
        "creation", "projection", "archive", "health", "review", "review_skip", "test_skip",
      ]);
      assert.deepEqual(result.passes.find((pass) => pass.name === "review")?.errors, ["PR read failed"]);
      assert.equal(result.totalTestSkipTransitions, 1);
      assert.equal(store.issues[String(skippedTest.iid)]?.workflowState, "done");
      assert.equal(store.issues[String(queued.iid)]?.workflowState, "todo");
      assert.equal(result.totalPickups, 0);
      assert.equal(result.totalSkipped, 1);
      assert.equal(harness.commands.commands.length, 0);
      assert.ok(warnings.some((message) => message.includes("review: PR read failed")));
    } finally { await harness.cleanup(); }
  });

  it("does not start an earlier idle project when a later project owns an active slot", async () => {
    const harness = await createTestHarness();

    try {
      const idle = structuredClone(harness.project);
      const active = structuredClone(harness.project);

      active.slug = "active-project";
      active.workers.developer.levels.senior = [{ active: true, issueId: 8, sessionKey: "worker", startTime: new Date().toISOString() }];
      for (const registry of [{ idle, active }, { active, idle }]) {
        const projects = Object.fromEntries(Object.values(registry).map(project => [project.slug, project]));

        assert.equal(mayScheduleProject(idle.slug, projects, EXECUTION_MODE.SEQUENTIAL), false);
        assert.equal(mayScheduleProject(active.slug, projects, EXECUTION_MODE.SEQUENTIAL), true);
        assert.equal(mayScheduleProject(idle.slug, projects, EXECUTION_MODE.PARALLEL), true);
      }
    } finally { await harness.cleanup(); }
  });

  it("normalizes duplicate SDK workspaces and isolates malformed registry discovery", async () => {
    const harness = await createTestHarness();

    try {
      const invalidWorkspace = path.join(harness.workspaceDir, "invalid-workspace");

      await fs.mkdir(path.join(invalidWorkspace, DATA_DIR), { recursive: true });
      await fs.writeFile(path.join(invalidWorkspace, DATA_DIR, "projects.json"), "{broken");
      const result = await discoverAgents({ agents: { list: [
        { id: harness.project.agentId, workspace: harness.workspaceDir },
        { id: harness.project.agentId, workspace: path.join(harness.workspaceDir, ".") },
        { id: "invalid-agent", workspace: invalidWorkspace },
      ] } });

      assert.deepEqual(result.agents, [{ agentId: harness.project.agentId, workspace: await fs.realpath(harness.workspaceDir) }]);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0] ?? "", /invalid-agent/);
    } finally { await harness.cleanup(); }
  });

  it("continues healthy-agent maintenance after another agent's registry fails", async () => {
    const harness = await createTestHarness();

    try {
      const invalidWorkspace = path.join(harness.workspaceDir, "broken-agent");
      const warnings: string[] = [];

      await fs.mkdir(path.join(invalidWorkspace, DATA_DIR), { recursive: true });
      await fs.writeFile(path.join(invalidWorkspace, DATA_DIR, "projects.json"), "{broken");
      const result = await processAllAgents([
        { agentId: "broken", workspace: invalidWorkspace },
        { agentId: harness.project.agentId, workspace: harness.workspaceDir },
      ], { enabled: true, intervalSeconds: 60, maxPickupsPerTick: 0 }, undefined,
      { info() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } }, harness.runCommand);

      assert.ok(result.passes.some(pass => pass.projectSlug === harness.project.slug));
      assert.ok(warnings.some(message => message.includes("broken")));
    } finally { await harness.cleanup(); }
  });

  it("does not substitute a project's first channel for an issue's missing exact target", async () => {
    const harness = await createTestHarness();

    try {
      const project = { ...harness.project, channels: [...harness.project.channels,
        { ...harness.project.channels[0], channelId: "second-channel", threadId: "topic-2" }] };
      const event = { type: "prClosed", project: project.name, issueId: 1, issueTitle: "Review", issueUrl: "https://example.test/1", nextState: "Rejected" } as const;

      await notifyReviewEvent({ workspaceDir: harness.workspaceDir, project, issueId: 1, event,
        config: {}, runCommand: harness.runCommand });
      assert.equal(harness.commands.commands.length, 0, "unbound issue never sends to the primary channel");
    } finally { await harness.cleanup(); }
  });

  it("uses the saved second endpoint, account, and topic for review events", async () => {
    const harness = await createTestHarness();

    try {
      const second = { ...harness.project.channels[0], channelId: "second-channel", name: "review-topic", threadId: "topic-2" };
      const project = { ...harness.project, channels: [...harness.project.channels, second] };
      const issue = harness.provider.seedIssue({ iid: 7, labels: ["To Review"] });
      const sends: Array<{ to: string; threadId?: string; accountId: string }> = [];

      await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue,
        providerType: project.provider, workflow: harness.workflow, workflowState: "toReview", workflowLabel: "To Review" });
      await updateIssueRuntimeRecord(harness.workspaceDir, project.slug, 7, current => {
        if (!current) throw new Error("Review issue missing from local state.");

        return { ...current, notifyTarget: { channel: second.channel, name: second.name } };
      });
      const runtime = {
        config: { current: () => ({ agents: { list: [{ id: project.agentId }] },
          channels: { telegram: { enabled: true, accounts: { [second.accountId]: {} } } },
          bindings: [{ agentId: project.agentId, match: { channel: second.channel, accountId: second.accountId,
            peer: { kind: "group" as const, id: `${second.channelId}:topic:${second.threadId}` } } }] }) },
        channel: { outbound: { loadAdapter: async () => ({
          sendText: async (payload: { to: string; threadId?: string; accountId: string }) => {
            sends.push(payload);

            return { messageId: "accepted" };
          },
        }) } },
      };

      await notifyReviewEvent({ workspaceDir: harness.workspaceDir, project, issueId: 7,
        event: { type: "changesRequested", project: project.name, issueId: 7, issueTitle: issue.title, issueUrl: issue.web_url, nextState: "To Improve" },
        config: {}, runtime, runCommand: harness.runCommand });
      assert.deepEqual(sends.map(({ to, threadId, accountId }) => ({ to, threadId, accountId })),
        [{ to: second.channelId, threadId: second.threadId, accountId: second.accountId }]);
    } finally { await harness.cleanup(); }
  });
});
