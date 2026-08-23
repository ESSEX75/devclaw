import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createManagedTaskIssue, getManagedTaskStatus, listManagedTasks } from "./index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { DEFAULT_WORKFLOW } from "../../domain/index.js";

describe("task query use cases", () => {
  it("lists initialized managed issues from local state", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-task-list-"));
    try {
      const provider = new TestProvider();
      const created = await createManagedTaskIssue({
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
        title: "Implement search",
        description: "Build search",
        owner: "main",
      });

      const result = await listManagedTasks({
        workspaceDir: tmpDir,
        projectSlug: "devclaw",
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        provider,
        label: "Planning",
      });

      assert.strictEqual(result.totalIssues, 1);
      assert.strictEqual(result.states[0]?.label, "Planning");
      assert.strictEqual(result.states[0]?.issues[0]?.id, created.issue.iid);
      assert.strictEqual(result.states[0]?.issues[0]?.projection.localState?.workflowState, "planning");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports execution-aware task status from local state", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-task-status-"));
    try {
      const provider = new TestProvider();
      const created = await createManagedTaskIssue({
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
        title: "Implement queue",
        description: "Build queue",
        owner: "main",
      });

      const status = await getManagedTaskStatus({
        workspaceDir: tmpDir,
        projectSlug: "devclaw",
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer"],
        provider,
      });

      assert.strictEqual(status.summary.totalHold, 1);
      assert.strictEqual(status.summary.totalQueued, 0);
      assert.strictEqual(status.summary.totalActive, 0);
      assert.strictEqual(status.hold.Planning?.issues[0]?.id, created.issue.iid);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
