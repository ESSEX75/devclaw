import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readIssueStateStore } from "../../state/issues/index.js";
import { extractIssueMetadata } from "../../projection/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { DEFAULT_WORKFLOW } from "../../domain/index.js";
import { createManagedTaskIssue } from "../../application/tasks/index.js";

describe("task_create managed queue flow", () => {
  it("creates ordinary tasks directly in the developer queue with local state projection", async () => {
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

      assert.strictEqual(provider.callsTo("createIssue")[0]?.args.label, "To Do");
      assert.strictEqual(result.label, "To Do");
      assert.strictEqual(result.workflowState, "todo");
      assert.strictEqual(result.role, "developer");
      assert.strictEqual(state.workflowState, "todo");
      assert.strictEqual(state.workflowLabel, "To Do");
      assert.strictEqual(state.assignedRole, "developer");
      assert.strictEqual(state.assignedLevel, null);
      assert.strictEqual(state.owner, "main");
      assert.strictEqual(state.reviewPolicy, "human");
      assert.strictEqual(state.testPolicy, "skip");
      assert.deepStrictEqual(state.notifyTarget, {
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "primary",
      });
      assert.ok(issue.labels.includes("To Do"));
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
