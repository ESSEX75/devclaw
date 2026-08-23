import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readIssueStateStore } from "../../state/issues/index.js";
import { extractIssueMetadata } from "../../projection/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL, STATE_TYPE, type WorkflowConfig, WORKFLOW_EVENT } from "../../domain/index.js";
import { DEFAULT_WORKFLOW } from "../../domain/index.js";
import { createManagedTaskIssue } from "../../application/tasks/index.js";

describe("task_create managed initial-state flow", () => {
  it("preserves a custom hold initial state without resolving its queue transition", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-task-create-hold-"));
    const workflow: WorkflowConfig = {
      initial: "triage",
      states: {
        triage: {
          type: STATE_TYPE.HOLD,
          label: "Needs Triage",
          color: "#64748b",
        },
      },
    };

    try {
      const provider = new TestProvider({ workflow });
      const result = await createManagedTaskIssue({
        workspaceDir: tmpDir,
        project: { slug: "triage-app", channels: [] },
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow,
        title: "Investigate checkout",
        description: "Clarify the expected behavior",
      });
      const store = await readIssueStateStore(tmpDir, "triage-app");
      const state = store.issues[String(result.issue.iid)];

      assert.equal(result.workflowState, "triage");
      assert.equal(result.label, "Needs Triage");
      assert.equal(result.role, null);
      assert.equal(state?.workflowState, "triage");
      assert.equal(state?.assignedRole, null);
      assert.equal(state?.assignedLevel, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("persists a validated custom initial state key, label, and role", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-task-create-custom-"));
    const workflow: WorkflowConfig = {
      initial: "designQueue",
      states: {
        designQueue: {
          type: STATE_TYPE.QUEUE,
          role: "designer",
          label: "To Design",
          color: "#a855f7",
          on: {
            [WORKFLOW_EVENT.PICKUP]: {
              target: "designing",
            },
          },
        },
        designing: {
          type: STATE_TYPE.ACTIVE,
          role: "designer",
          label: "Designing",
          color: "#7e22ce",
        },
      },
    };

    try {
      const provider = new TestProvider({ workflow });
      const result = await createManagedTaskIssue({
        workspaceDir: tmpDir,
        project: {
          slug: "design-app",
          channels: [],
        },
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow,
        title: "Design checkout",
        description: "Prepare the checkout design",
      });
      const store = await readIssueStateStore(tmpDir, "design-app");
      const state = store.issues[String(result.issue.iid)];

      assert.equal(result.workflowState, "designQueue");
      assert.equal(result.label, "To Design");
      assert.equal(result.role, "designer");
      assert.equal(state?.workflowState, "designQueue");
      assert.equal(state?.workflowLabel, "To Design");
      assert.equal(state?.assignedRole, "designer");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates ordinary tasks in the default hold state with local state projection", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-task-create-"));
    try {
      const provider = new TestProvider();

      const result = await createManagedTaskIssue({
        workspaceDir: tmpDir,
        project: {
          slug: "devclaw",
        channels: [{
          channelId: "telegram:1",
          channel: NOTIFICATION_CHANNEL.TELEGRAM,
          name: "primary",
        }],
        },
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow: DEFAULT_WORKFLOW,
        title: "Implement login",
        description: "Build the login screen",
        notifyTarget: { channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" },
        owner: "main",
      });

      const issue = await provider.getIssue(result.issue.iid);
      const store = await readIssueStateStore(tmpDir, "devclaw");
      const state = store.issues[String(result.issue.iid)]!;

      assert.strictEqual(provider.callsTo("createIssue")[0]?.args.label, "Planning");
      assert.strictEqual(result.label, "Planning");
      assert.strictEqual(result.workflowState, "planning");
      assert.strictEqual(result.role, null);
      assert.match(result.announcementSuffix, /task_start/);
      assert.strictEqual(state.workflowState, "planning");
      assert.strictEqual(state.workflowLabel, "Planning");
      assert.strictEqual(state.assignedRole, null);
      assert.strictEqual(state.assignedLevel, null);
      assert.strictEqual(state.owner, "main");
      assert.strictEqual(state.reviewPolicy, "human");
      assert.strictEqual(state.testPolicy, "skip");
      assert.deepStrictEqual(state.notifyTarget, {
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "primary",
      });
      assert.ok(issue.labels.includes("Planning"));
      assert.ok(!issue.labels.includes("To Do"));
      assert.ok(issue.labels.includes("owner:main"));
      assert.ok(issue.labels.includes("review:human"));
      assert.ok(issue.labels.includes("test:skip"));
      assert.ok(issue.labels.includes("notify:telegram:primary"));
      assert.deepStrictEqual(extractIssueMetadata(issue.description), {
        projectSlug: "devclaw",
        issueId: result.issue.iid,
        projectionVersion: 1,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
