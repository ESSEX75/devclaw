import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  type IssueRuntimeState,
  type Project,
} from "../../domain/index.js";
import { emptyIssueStateStore, writeIssueStateStore } from "../../state/issues/index.js";
import { resolveIssueNotificationEndpoint } from "./resolve-endpoint.js";

describe("managed notification endpoint resolution", () => {
  it("uses the local binding instead of a provider routing hint", async () => {
    await withIssueBinding(async (workspaceDir, project) => {
      const endpoint = await resolveIssueNotificationEndpoint(workspaceDir, project, 79);

      assert.ok(endpoint);
      assert.equal(endpoint.channelId, "-200");
      assert.equal(endpoint.threadId, "7");
    });
  });

  it("does not redirect an unresolved local binding to the first endpoint", async () => {
    await withIssueBinding(async (workspaceDir, project) => {
      project.channels = project.channels.filter((endpoint) => endpoint.name !== "task-topic");

      const endpoint = await resolveIssueNotificationEndpoint(workspaceDir, project, 79);

      assert.equal(endpoint, undefined);
    });
  });
});

async function withIssueBinding(
  run: (workspaceDir: string, project: Project) => Promise<void>,
): Promise<void> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-binding-"));
  const project = projectFixture();
  const store = emptyIssueStateStore(project.slug);

  store.issues["79"] = issueState();
  await writeIssueStateStore(workspaceDir, project.slug, store);

  try {
    await run(workspaceDir, project);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

function projectFixture(): Project {
  return {
    slug: "devclaw",
    name: "DevClaw",
    repo: "D:/web/devclaw",
    groupName: "DevClaw",
    deployUrl: "",
    baseBranch: "main",
    deployBranch: "main",
    channels: [
      { channelId: "-100", channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" },
      {
        channelId: "-200",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "task-topic",
        threadId: "7",
      },
    ],
    provider: ISSUE_PROVIDER.GITHUB,
    workers: {},
  };
}

function issueState(): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 79,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "junior",
    notifyTarget: { channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "task-topic" },
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
